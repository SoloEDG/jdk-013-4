import { ref, type Ref } from "vue";
import type { Camera } from "../../../shared/types";
import type { RecEvent } from "./types";

const DRAFT_KEY = "tidal-route-draft-v1";
const CAMERA_SAMPLE_MS = 250;

export interface Recorder {
  mode: Ref<"idle" | "recording" | "paused">;
  /** 录制墙钟（秒），仅用于录制中的界面展示 */
  wall: Ref<number>;
  /** 主线累计时长（秒），按媒体时间推进 */
  mainElapsed: Ref<number>;
  /** 支线累计停留（秒），独立时钟 */
  branchElapsed: Ref<number>;
  eventCount: Ref<number>;
  start: (chapterId: string, camera: Camera) => void;
  pause: () => void;
  resume: () => void;
  stop: () => RecEvent[];
  discard: () => void;
  chapter: (chapterId: string, camera: Camera) => void;
  seek: (time: number, camera: Camera) => void;
  camera: (srcTime: number, camera: Camera) => void;
  hotspot: (hotspotId: string) => void;
  branchEnter: (args: {
    personId: string;
    returnChapterId: string;
    returnTime: number;
    returnCamera: Camera;
    returnPlaying: boolean;
  }) => void;
  branchLeave: (endParagraph: number, finished: boolean) => void;
  /** 主线播放推进（秒）；暂停与支线期间不推进，保证等待不入主线 */
  advance: (delta: number) => void;
  events: () => RecEvent[];
}

interface Draft {
  events: RecEvent[];
  wall: number;
  mainElapsed: number;
  branchElapsed: number;
  startedAt: number;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return Array.isArray(d.events) ? d : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 空间不足时忽略，录制仍在内存中继续 */
  }
}

export function createRecorder(): Recorder {
  const draft = loadDraft();
  const mode = ref<"idle" | "recording" | "paused">(draft ? "paused" : "idle");
  const wall = ref(draft?.wall ?? 0);
  const mainElapsed = ref(draft?.mainElapsed ?? 0);
  const branchElapsed = ref(draft?.branchElapsed ?? 0);
  const eventCount = ref(draft?.events.length ?? 0);

  let events: RecEvent[] = draft?.events ?? [];
  let lastCameraAt = 0;
  let lastCamera: Camera | null = null;
  let branchStartedAt = 0;
  let branchBase = 0;

  function now(): number {
    return performance.now();
  }

  function persist() {
    saveDraft({
      events,
      wall: wall.value,
      mainElapsed: mainElapsed.value,
      branchElapsed: branchElapsed.value,
      startedAt: Date.now(),
    });
    eventCount.value = events.length;
  }

  function push(e: RecEvent) {
    events.push(e);
    persist();
  }

  function start(chapterId: string, camera: Camera) {
    events = [];
    wall.value = 0;
    mainElapsed.value = 0;
    branchElapsed.value = 0;
    lastCamera = null;
    mode.value = "recording";
    push({ type: "chapter", at: now(), chapterId, camera: { ...camera } });
  }

  function pause() {
    if (mode.value !== "recording") return;
    mode.value = "paused";
    push({ type: "pause", at: now() });
  }

  function resume() {
    if (mode.value !== "paused") return;
    mode.value = "recording";
    lastCameraAt = 0;
    push({ type: "resume", at: now() });
  }

  function stop(): RecEvent[] {
    const out = events;
    mode.value = "idle";
    events = [];
    wall.value = 0;
    mainElapsed.value = 0;
    branchElapsed.value = 0;
    eventCount.value = 0;
    saveDraft(null);
    return out;
  }

  function discard() {
    stop();
  }

  function chapter(chapterId: string, camera: Camera) {
    if (mode.value !== "recording") return;
    lastCamera = { ...camera };
    push({ type: "chapter", at: now(), chapterId, camera: { ...camera } });
  }

  function seek(time: number, camera: Camera) {
    if (mode.value !== "recording") return;
    lastCamera = { ...camera };
    push({ type: "seek", at: now(), time, camera: { ...camera } });
  }

  function camera(srcTime: number, cam: Camera) {
    if (mode.value !== "recording" || branchStartedAt > 0) return;
    const t = now();
    if (
      lastCamera &&
      t - lastCameraAt < CAMERA_SAMPLE_MS &&
      Math.abs(lastCamera.yaw - cam.yaw) < 0.4 &&
      Math.abs(lastCamera.pitch - cam.pitch) < 0.4 &&
      Math.abs(lastCamera.fov - cam.fov) < 0.4
    ) {
      return;
    }
    lastCameraAt = t;
    lastCamera = { ...cam };
    push({ type: "camera", at: t, srcTime, camera: { ...cam } });
  }

  function hotspot(hotspotId: string) {
    if (mode.value !== "recording") return;
    push({ type: "hotspot", at: now(), hotspotId });
  }

  function branchEnter(args: {
    personId: string;
    returnChapterId: string;
    returnTime: number;
    returnCamera: Camera;
    returnPlaying: boolean;
  }) {
    if (mode.value !== "recording") return;
    branchStartedAt = now();
    branchBase = branchElapsed.value;
    push({ type: "branch-enter", at: now(), ...args });
  }

  function branchLeave(endParagraph: number, finished: boolean) {
    if (mode.value !== "recording" || !branchStartedAt) return;
    const visit = (now() - branchStartedAt) / 1000;
    branchElapsed.value = branchBase + visit;
    branchStartedAt = 0;
    // 返回主线后重置采样节流：保证返回点的衔接镜头一定被记录，
    // 否则紧随其后的短主线片段可能因缺少关键帧而被丢弃，造成返回点悬空
    lastCameraAt = 0;
    lastCamera = null;
    push({
      type: "branch-leave",
      at: now(),
      visitElapsed: visit,
      endParagraph,
      finished,
    });
  }

  function advance(delta: number) {
    if (mode.value !== "recording" || branchStartedAt > 0) return;
    mainElapsed.value += delta;
    wall.value = mainElapsed.value + branchElapsed.value;
  }

  return {
    mode,
    wall,
    mainElapsed,
    branchElapsed,
    eventCount,
    start,
    pause,
    resume,
    stop,
    discard,
    chapter,
    seek,
    camera,
    hotspot,
    branchEnter,
    branchLeave,
    advance,
    events: () => events,
  };
}
