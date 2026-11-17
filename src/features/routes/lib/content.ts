import { chapters, hotspots, people } from "../../../shared/content";
import { reindex } from "./timeline";
import type {
  ContentSnapshot,
  GapStep,
  MainStep,
  RouteFile,
  RouteStep,
} from "../model/types";

/** 当前播放端的素材版本。素材内容变更时递增，供接收端判断兼容性。 */
export const CURRENT_CONTENT_VERSION = 2026_11_17;

export interface ResolveIssue {
  level: "skip" | "warn";
  reason: string;
}

let gapCounter = 0;
function gapId(): string {
  gapCounter += 1;
  return `gap-${Date.now().toString(36)}-${gapCounter}`;
}

export function buildSnapshot(): ContentSnapshot {
  return {
    contentVersion: CURRENT_CONTENT_VERSION,
    chapters: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      duration: c.duration,
    })),
    hotspots: hotspots.map((h) => ({
      id: h.id,
      chapterId: h.chapterId,
      personId: h.personId,
    })),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      paragraphs: p.paragraphs.length,
    })),
  };
}

export function chapterTitleOf(file: RouteFile, id: string): string {
  return file.snapshot.chapters.find((c) => c.id === id)?.title ?? id;
}

export function personNameOf(file: RouteFile, id: string): string {
  return file.snapshot.people.find((p) => p.id === id)?.name ?? id;
}

/**
 * 把一份路线文件解析为当前设备可播放的步骤序列。
 * 容错原则：任何素材缺失都只跳过受影响的部分并给出解释，
 * 缺失片段转成不占播放时长的 gap 步骤，剩余路线完整保留。
 */
export function resolveRoute(file: RouteFile): {
  steps: RouteStep[];
  issues: ResolveIssue[];
  versionMismatch: boolean;
} {
  const issues: ResolveIssue[] = [];
  const versionMismatch =
    file.snapshot.contentVersion !== CURRENT_CONTENT_VERSION;
  if (versionMismatch) {
    issues.push({
      level: "warn",
      reason: `路线录制于素材版本 ${file.snapshot.contentVersion}，当前设备为 ${CURRENT_CONTENT_VERSION}，已尝试兼容播放，部分内容可能被跳过。`,
    });
  }

  const chapterIds = new Set(chapters.map((c) => c.id));
  const personIds = new Set(people.map((p) => p.id));
  const hotspotIds = new Set(hotspots.map((h) => h.id));

  const steps: RouteStep[] = [];
  for (const raw of file.steps) {
    if (raw.kind === "main") {
      if (!chapterIds.has(raw.chapterId)) {
        issues.push({
          level: "skip",
          reason: `章节「${chapterTitleOf(file, raw.chapterId)}」在当前素材中已不存在，已跳过该段主线（原时长 ${Math.round(
            raw.srcEnd - raw.srcStart,
          )} 秒），其后的路线保留。`,
        });
        steps.push(
          makeGap(
            raw,
            `章节「${chapterTitleOf(file, raw.chapterId)}」已下线，已跳过`,
            raw.chapterId,
          ),
        );
        continue;
      }
      const step: MainStep = { ...raw, markers: [] };
      for (const m of raw.markers) {
        if (hotspotIds.has(m.hotspotId)) step.markers.push(m);
        else {
          issues.push({
            level: "skip",
            reason: `热点「${m.title}」在当前素材中已不存在，已从路线中省略，不影响后续播放。`,
          });
        }
      }
      steps.push(step);
    } else if (raw.kind === "branch") {
      if (!personIds.has(raw.personId)) {
        issues.push({
          level: "skip",
          reason: `人物访谈「${personNameOf(file, raw.personId)}」已下线，已跳过该支线停留（支线时间原本就不计入主线）。`,
        });
        steps.push(
          makeGap(raw, `人物「${personNameOf(file, raw.personId)}」已下线，支线跳过`),
        );
        continue;
      }
      if (!chapterIds.has(raw.returnChapterId)) {
        issues.push({
          level: "skip",
          reason: `支线「${personNameOf(file, raw.personId)}」的返回章节已不存在，返回后将从下一有效片段继续。`,
        });
      }
      steps.push({ ...raw });
    } else {
      steps.push({ ...raw });
    }
  }

  // gap 不占播放时长，合并后必须重铺时间轴，保证剩余步骤连续可定位
  const merged = reindex(mergeGaps(steps));
  return { steps: merged, issues, versionMismatch };
}

function makeGap(origin: RouteStep, reason: string, chapterId?: string): GapStep {
  return {
    id: gapId(),
    kind: "gap",
    routeStart: origin.routeStart,
    routeEnd: origin.routeStart,
    reason,
    chapterId,
  };
}

/** 相邻 gap 合并为一条解释，避免连续弹窗 */
function mergeGaps(steps: RouteStep[]): RouteStep[] {
  const out: RouteStep[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (s.kind === "gap" && last?.kind === "gap") {
      last.reason = `${last.reason}；${s.reason}`;
    } else {
      out.push(s);
    }
  }
  return out;
}
