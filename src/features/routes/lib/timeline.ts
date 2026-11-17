import { clamp, wrap } from "../../../shared/format";
import type { Camera } from "../../../shared/types";
import type {
  BranchStep,
  CameraKey,
  MainMarker,
  MainStep,
  RecEvent,
  RouteStep,
} from "../model/types";

type OpenMain = {
  chapterId: string;
  srcStart: number;
  lastSrc: number;
  enterCamera: Camera;
  keys: CameraKey[];
  markers: MainMarker[];
};

let counter = 0;
function stepId(): string {
  counter += 1;
  return `step-${Date.now().toString(36)}-${counter}`;
}

function sameCamera(a: Camera, b: Camera): boolean {
  return (
    Math.abs(a.yaw - b.yaw) < 0.05 &&
    Math.abs(a.pitch - b.pitch) < 0.05 &&
    Math.abs(a.fov - b.fov) < 0.05
  );
}

/**
 * 把录制器产出的原始事件归并为路线步骤。
 * 关键不变量：
 *  - 主线片段时长全部以「章节媒体时间」计量，暂停/等待不会进入主线；
 *  - 支线是独立步骤，拥有独立时钟，永远不计入主线时长；
 *  - 每次支线结束都在其返回点开启新的主线片段，衔接点因此显式存在。
 */
export function buildSteps(
  events: RecEvent[],
  durations: Map<string, number>,
  hotspotTitles: Map<string, string>,
): RouteStep[] {
  const steps: RouteStep[] = [];
  // 收进 holder 对象：闭包内的赋值不会破坏属性访问的控制流窄化
  const ctx: {
    open: OpenMain | null;
    openBranch: BranchStep | null;
  } = { open: null, openBranch: null };
  // 当前上下文：即便没有打开的主线片段（如支线中），也保留章节与镜头
  let chapterId = "";
  let camera: Camera = { yaw: 0, pitch: 0, fov: 70 };
  let lastReturn: {
    chapterId: string;
    time: number;
    camera: Camera;
    playing: boolean;
  } | null = null;

  function closeMain() {
    const cur = ctx.open;
    if (!cur) return;
    const duration = durations.get(cur.chapterId);
    if (duration !== undefined) {
      const srcEnd = clamp(cur.lastSrc, cur.srcStart, duration);
      if (srcEnd - cur.srcStart >= 0.05) {
        const keys = cur.keys
          .filter((k) => k.srcTime >= cur.srcStart && k.srcTime <= srcEnd)
          .sort((a, b) => a.srcTime - b.srcTime)
          .filter(
            (k, i, arr) => i === 0 || !sameCamera(arr[i - 1]!.camera, k.camera),
          );
        const firstKey = keys[0];
        if (!firstKey || firstKey.srcTime > cur.srcStart + 0.01) {
          keys.unshift({ srcTime: cur.srcStart, camera: { ...cur.enterCamera } });
        }
        if (
          keys.length === 1 ||
          keys[keys.length - 1]!.srcTime < srcEnd
        ) {
          const lastCam = keys[keys.length - 1]!.camera;
          keys.push({ srcTime: srcEnd, camera: { ...lastCam } });
        }
        steps.push({
          id: stepId(),
          kind: "main",
          routeStart: 0,
          routeEnd: 0,
          chapterId: cur.chapterId,
          srcStart: cur.srcStart,
          srcEnd,
          enterCamera: { ...cur.enterCamera },
          keys,
          markers: cur.markers.filter(
            (m) => m.srcTime >= cur.srcStart && m.srcTime <= srcEnd,
          ),
        });
      }
    }
    ctx.open = null;
  }

  function openMain(startChapter: string, srcStart: number, cam: Camera) {
    const duration = durations.get(startChapter);
    if (duration === undefined) return;
    ctx.open = {
      chapterId: startChapter,
      srcStart: clamp(srcStart, 0, duration),
      lastSrc: clamp(srcStart, 0, duration),
      enterCamera: { ...cam },
      keys: [],
      markers: [],
    };
  }

  for (const e of events) {
    switch (e.type) {
      case "chapter":
        chapterId = e.chapterId;
        camera = { ...e.camera };
        closeMain();
        openMain(chapterId, 0, camera);
        break;
      case "seek": {
        camera = { ...e.camera };
        const cur = ctx.open;
        if (cur && cur.chapterId === chapterId && e.time !== cur.lastSrc) {
          closeMain();
          openMain(chapterId, e.time, camera);
        }
        break;
      }
      case "camera": {
        camera = { ...e.camera };
        const cur = ctx.open;
        if (!cur || ctx.openBranch) break;
        const duration = durations.get(cur.chapterId);
        if (duration === undefined) break;
        const srcTime = clamp(e.srcTime, cur.srcStart, duration);
        const last = cur.keys[cur.keys.length - 1];
        if (last && sameCamera(last.camera, e.camera)) break;
        cur.keys.push({ srcTime, camera: { ...e.camera } });
        cur.lastSrc = Math.max(cur.lastSrc, srcTime);
        break;
      }
      case "hotspot": {
        const cur = ctx.open;
        if (cur) {
          cur.markers.push({
            srcTime: cur.lastSrc,
            hotspotId: e.hotspotId,
            title: hotspotTitles.get(e.hotspotId) ?? e.hotspotId,
          });
        }
        break;
      }
      case "branch-enter":
        lastReturn = {
          chapterId: e.returnChapterId,
          time: e.returnTime,
          camera: { ...e.returnCamera },
          playing: e.returnPlaying,
        };
        chapterId = e.returnChapterId;
        closeMain();
        ctx.openBranch = {
          id: stepId(),
          kind: "branch",
          routeStart: 0,
          routeEnd: 0,
          personId: e.personId,
          returnChapterId: e.returnChapterId,
          returnTime: e.returnTime,
          returnCamera: { ...e.returnCamera },
          returnPlaying: e.returnPlaying,
          visitElapsed: 0,
          endParagraph: 0,
          finished: false,
        };
        steps.push(ctx.openBranch);
        break;
      case "branch-leave": {
        const cur = ctx.openBranch;
        if (cur) {
          cur.visitElapsed =
            Math.max(0.5, Math.round(e.visitElapsed * 10) / 10);
          cur.endParagraph = e.endParagraph;
          cur.finished = e.finished;
          ctx.openBranch = null;
        }
        // 在保存的返回点重新开启主线片段：支线时间不进入主线
        if (lastReturn) {
          chapterId = lastReturn.chapterId;
          camera = { ...lastReturn.camera };
          openMain(chapterId, lastReturn.time, camera);
        }
        break;
      }
      case "pause":
      case "resume":
        // 暂停期间媒体时间不前进，主线时长天然不含等待
        break;
    }
  }
  closeMain();
  return reindex(steps);
}

/**
 * 按当前有效步骤重新铺设路线时间轴。
 * main 的时长来自源时间差（主线），branch 的时长来自独立的支线时钟，
 * gap 只占解释位置、不占播放时长。
 */
export function reindex(steps: RouteStep[]): RouteStep[] {
  let t = 0;
  for (const s of steps) {
    if (s.removed) {
      s.routeStart = t;
      s.routeEnd = t;
      continue;
    }
    s.routeStart = t;
    if (s.kind === "main") t += Math.max(0, s.srcEnd - s.srcStart);
    else if (s.kind === "branch") t += s.visitElapsed;
    s.routeEnd = t;
  }
  return steps;
}

export function activeSteps(steps: RouteStep[]): RouteStep[] {
  return steps.filter((s) => !s.removed);
}

export function stepDuration(step: RouteStep): number {
  if (step.removed) return 0;
  if (step.kind === "main") return step.srcEnd - step.srcStart;
  if (step.kind === "branch") return step.visitElapsed;
  return 0;
}

export function totals(steps: RouteStep[]) {
  let main = 0;
  let branch = 0;
  let trimmed = 0;
  for (const s of steps) {
    if (s.removed) {
      if (s.kind === "main") trimmed += s.srcEnd - s.srcStart;
      else if (s.kind === "branch") trimmed += s.visitElapsed;
    } else if (s.kind === "main") main += s.srcEnd - s.srcStart;
    else if (s.kind === "branch") branch += s.visitElapsed;
  }
  return { main, branch, trimmed, total: main + branch };
}

/**
 * 剪掉一个主线片段中的 [from, to]（源时间轴，秒）。
 * 原片段被替换为至多两个保留片段，中间插入的等待不会计入主线时长；
 * 相邻片段自动重新衔接（下一段的进入镜头取剪切点处的插值镜头）。
 * 被剪掉的原始片段以 removed 标记保留，可恢复。
 */
export function cutRange(
  steps: RouteStep[],
  stepIdValue: string,
  from: number,
  to: number,
): RouteStep[] {
  const idx = steps.findIndex((s) => s.id === stepIdValue);
  const target = idx >= 0 ? steps[idx] : undefined;
  if (!target || target.kind !== "main") return steps;
  const a = clamp(Math.min(from, to), target.srcStart, target.srcEnd);
  const b = clamp(Math.max(from, to), target.srcStart, target.srcEnd);
  if (b - a < 0.05) return steps;

  const removed: MainStep = {
    ...target,
    id: stepId(),
    removed: true,
    srcStart: a,
    srcEnd: b,
    // 注意：插值基准必须是原片段的完整关键帧，而非截断后的 keys
    enterCamera: cameraAt(target, a),
    keys: target.keys.filter((k) => k.srcTime >= a && k.srcTime <= b),
    markers: target.markers.filter((m) => m.srcTime >= a && m.srcTime <= b),
  };

  const keep: RouteStep[] = [];
  if (a - target.srcStart >= 0.05) {
    const tailKeys = target.keys.filter((k) => k.srcTime <= a).map((k) => ({ ...k }));
    if (tailKeys[tailKeys.length - 1]?.srcTime !== a) {
      tailKeys.push({ srcTime: a, camera: cameraAt(target, a) });
    }
    keep.push({
      ...target,
      id: stepId(),
      srcEnd: a,
      enterCamera: { ...target.enterCamera },
      keys: tailKeys,
      markers: target.markers.filter((m) => m.srcTime <= a),
    });
  }
  if (target.srcEnd - b >= 0.05) {
    const headKeys = target.keys.filter((k) => k.srcTime >= b).map((k) => ({ ...k }));
    const boundaryCamera = cameraAt(target, b);
    if (headKeys[0]?.srcTime !== b) {
      headKeys.unshift({ srcTime: b, camera: boundaryCamera });
    }
    keep.push({
      ...target,
      id: stepId(),
      srcStart: b,
      // 剪切点镜头取自原片段完整关键帧的插值，保证运动连贯衔接
      enterCamera: boundaryCamera,
      keys: headKeys,
      markers: target.markers.filter((m) => m.srcTime >= b),
    });
  }

  const next = [...steps.slice(0, idx), ...keep, removed, ...steps.slice(idx + 1)];
  // 裁剪产生的两个片段在源时间轴上首尾相接，reconnect 不得覆盖已算好的衔接镜头
  reconnect(next, /* preserveTouched */ new Set(keep.map((k) => k.id)));
  return reindex(next);
}

/** 整段剪掉（主线或支线均可），并重新衔接其后的主线返回点 */
export function cutStep(steps: RouteStep[], id: string): RouteStep[] {
  const next = steps.map((s) => (s.id === id ? { ...s, removed: true } : s));
  reconnect(next);
  return reindex(next);
}

/** 恢复最近被剪掉的片段（支持主线区间片段与整段） */
export function restoreStep(steps: RouteStep[], id: string): RouteStep[] {
  const next = steps.map((s) => (s.id === id ? { ...s, removed: false } : s));
  reconnect(next);
  return reindex(next);
}

/**
 * 重衔接：遍历有效主线片段，确保相邻片段首尾相接。
 * 同章节相邻片段若存在间隙（裁剪造成），后一片段的进入镜头改为
 * 间隙结束点的插值镜头，使剪切后的运动连贯；返回点（支线后开启的片段）
 * 在录制时已保存，不被覆盖。preserve 中的片段已由裁剪逻辑算好衔接镜头，跳过。
 */
export function reconnect(steps: RouteStep[], preserve?: Set<string>): void {
  let prev: MainStep | null = null;
  for (const s of steps) {
    if (s.removed || s.kind !== "main") {
      if (!s.removed && s.kind === "branch") prev = null;
      continue;
    }
    if (prev && prev.chapterId === s.chapterId && !preserve?.has(s.id)) {
      // 仅当源时间轴确实存在间隙时才改写进入镜头
      if (s.srcStart > prev.srcEnd + 0.01) {
        s.enterCamera = cameraAt(s, s.srcStart);
        const first = s.keys[0];
        if (first && first.srcTime <= s.srcStart + 0.01) {
          s.keys[0] = { srcTime: s.srcStart, camera: { ...s.enterCamera } };
        } else {
          s.keys.unshift({ srcTime: s.srcStart, camera: { ...s.enterCamera } });
        }
      }
    }
    prev = s;
  }
}

/** 取主线片段在某源时间点的插值镜头（偏航走最短弧） */
export function cameraAt(step: MainStep, srcTime: number): Camera {
  const t = clamp(srcTime, step.srcStart, step.srcEnd);
  const keys = step.keys;
  if (keys.length === 0) return { ...step.enterCamera };
  if (t <= keys[0]!.srcTime) return { ...keys[0]!.camera };
  if (t >= keys[keys.length - 1]!.srcTime)
    return { ...keys[keys.length - 1]!.camera };
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i]!;
    const k1 = keys[i + 1]!;
    if (t >= k0.srcTime && t <= k1.srcTime) {
      const span = k1.srcTime - k0.srcTime || 1;
      const r = (t - k0.srcTime) / span;
      const dyaw = wrap(k1.camera.yaw - k0.camera.yaw);
      return {
        yaw: wrap(k0.camera.yaw + dyaw * r),
        pitch: k0.camera.pitch + (k1.camera.pitch - k0.camera.pitch) * r,
        fov: k0.camera.fov + (k1.camera.fov - k0.camera.fov) * r,
      };
    }
  }
  return { ...step.enterCamera };
}

/** 路线时间轴上某时刻落在哪个有效步骤内，以及该步骤内的本地偏移 */
export function locate(
  steps: RouteStep[],
  routeTime: number,
): { step: RouteStep; local: number } | null {
  const list = activeSteps(steps);
  if (!list.length) return null;
  const t = clamp(routeTime, 0, list[list.length - 1]!.routeEnd);
  for (const s of list) {
    if (t <= s.routeEnd || s === list[list.length - 1]) {
      return { step: s, local: Math.max(0, t - s.routeStart) };
    }
  }
  return null;
}

/**
 * 连续性自检：有效主线片段的时间轴铺设必须无缝，
 * 且每个支线步骤的返回点都能对应到一个有效主线位置。
 */
export function verifyContinuity(steps: RouteStep[]): string[] {
  const errors: string[] = [];
  const list = activeSteps(steps);
  let t = 0;
  for (const s of list) {
    if (Math.abs(s.routeStart - t) > 0.01)
      errors.push(`步骤 ${s.id} 的路线时间轴存在断裂`);
    t = s.routeEnd;
  }
  for (const s of list) {
    if (s.kind === "main" && s.srcEnd < s.srcStart)
      errors.push(`主线片段 ${s.id} 的源时间倒置`);
    if (s.kind === "branch") {
      const ok = list.some(
        (m) =>
          m.kind === "main" &&
          m.chapterId === s.returnChapterId &&
          m.srcStart <= s.returnTime &&
          s.returnTime <= m.srcEnd,
      );
      if (!ok)
        errors.push(`支线 ${s.id} 的返回点没有可衔接的主线片段`);
    }
  }
  return errors;
}
