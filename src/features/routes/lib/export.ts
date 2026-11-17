import type { Camera } from "../../../shared/types";
import type {
  ContentSnapshot,
  RouteFile,
  RouteStep,
} from "../model/types";
import { activeSteps, reindex, totals } from "./timeline";

const FORMAT = "shoreline-route";

export function serializeRoute(
  steps: RouteStep[],
  meta: { id: string; title: string; createdAt: number; schemaVersion: number },
  snapshot: ContentSnapshot,
): RouteFile {
  // 导出只包含有效步骤，并重新铺设路线时间轴，避免携带编辑残留
  const kept = reindex(
    activeSteps(steps).map((s) => ({ ...structuredClone(s) })),
  );
  const t = totals(kept);
  return {
    format: FORMAT,
    meta: {
      ...meta,
      mainDuration: Math.round(t.main * 10) / 10,
      branchDuration: Math.round(t.branch * 10) / 10,
      trimmedDuration: Math.round(t.trimmed * 10) / 10,
    },
    snapshot,
    steps: kept,
  };
}

export function downloadRoute(file: RouteFile) {
  const safeTitle = file.meta.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `岸线路线-${safeTitle || "未命名"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isCamera(v: unknown): v is Camera {
  const c = v as Camera | null;
  return (
    !!c &&
    Number.isFinite(c.yaw) &&
    Number.isFinite(c.pitch) &&
    Number.isFinite(c.fov)
  );
}

/** 严格结构校验；不合法时抛错，由 UI 提示，绝不覆盖已有路线列表 */
export function parseRoute(raw: unknown): RouteFile {
  if (typeof raw !== "object" || raw === null)
    throw new Error("文件不是有效的路线对象");
  const f = raw as Partial<RouteFile>;
  if (f.format !== FORMAT)
    throw new Error("文件格式标识不正确，无法识别为岸线路线");
  if (!f.meta || typeof f.meta.title !== "string" || !f.snapshot)
    throw new Error("路线缺少必要的元信息或素材快照");
  if (!Array.isArray(f.steps) || f.steps.length === 0)
    throw new Error("路线中没有可播放的步骤");

  const steps: RouteStep[] = [];
  for (const [i, s] of f.steps.entries()) {
    if (typeof s !== "object" || s === null)
      throw new Error(`第 ${i + 1} 个步骤结构无效`);
    const base = {
      id: typeof s.id === "string" ? s.id : `imported-${i}`,
      routeStart: Number(s.routeStart) || 0,
      routeEnd: Number(s.routeEnd) || 0,
    };
    if (s.kind === "main") {
      if (
        typeof s.chapterId !== "string" ||
        !Number.isFinite(s.srcStart) ||
        !Number.isFinite(s.srcEnd) ||
        !isCamera(s.enterCamera) ||
        !Array.isArray(s.keys)
      )
        throw new Error(`第 ${i + 1} 个主线步骤字段不完整`);
      steps.push({
        ...base,
        kind: "main",
        chapterId: s.chapterId,
        srcStart: s.srcStart,
        srcEnd: Math.max(s.srcStart, s.srcEnd),
        enterCamera: s.enterCamera,
        keys: s.keys.filter(
          (k) => k && Number.isFinite(k.srcTime) && isCamera(k.camera),
        ),
        markers: Array.isArray(s.markers)
          ? s.markers.filter(
              (m) =>
                m &&
                typeof m.hotspotId === "string" &&
                typeof m.title === "string" &&
                Number.isFinite(m.srcTime),
            )
          : [],
      });
    } else if (s.kind === "branch") {
      if (
        typeof s.personId !== "string" ||
        typeof s.returnChapterId !== "string" ||
        !Number.isFinite(s.returnTime) ||
        !isCamera(s.returnCamera)
      )
        throw new Error(`第 ${i + 1} 个支线步骤字段不完整`);
      steps.push({
        ...base,
        kind: "branch",
        personId: s.personId,
        returnChapterId: s.returnChapterId,
        returnTime: s.returnTime,
        returnCamera: s.returnCamera,
        returnPlaying: !!s.returnPlaying,
        visitElapsed: Math.max(0.5, Number(s.visitElapsed) || 1),
        endParagraph: Number(s.endParagraph) || 0,
        finished: !!s.finished,
      });
    } else if (s.kind === "gap") {
      steps.push({ ...base, kind: "gap", reason: String(s.reason || "内容缺失") });
    } else {
      throw new Error(`第 ${i + 1} 个步骤类型未知`);
    }
  }
  return {
    format: FORMAT,
    meta: { ...(f.meta as RouteFile["meta"]) },
    snapshot: f.snapshot as ContentSnapshot,
    steps: reindex(steps),
  };
}

export async function readRouteFile(file: File): Promise<RouteFile> {
  const text = await file.text();
  return parseRoute(JSON.parse(text));
}
