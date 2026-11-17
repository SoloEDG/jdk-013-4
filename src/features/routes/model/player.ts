import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { Camera, Position } from "../../../shared/types";
import type {
  BranchStep,
  GapStep,
  MainStep,
  RouteStep,
} from "./types";
import { activeSteps, cameraAt, locate, stepDuration } from "../lib/timeline";
import type { Playback } from "../../chapters/model/playback";
import type { CameraController } from "../../panorama/model/camera";
import type { Branch } from "../../interviews/model/branch";
import { findPerson } from "../../interviews/lib/transcript";

export type PlayerMode = "idle" | "guided" | "detour";

export interface RouteNotice {
  id: number;
  kind: "marker" | "gap" | "info";
  text: string;
}

export interface RoutePlayer {
  mode: Ref<PlayerMode>;
  playing: Ref<boolean>;
  index: Ref<number>;
  routeTime: Ref<number>;
  current: ComputedRef<RouteStep | undefined>;
  notices: Ref<RouteNotice[]>;
  rejoinPoint: Ref<{ chapter: string; time: number; title: string } | null>;
  progress: ComputedRef<number>;
  totalDuration: ComputedRef<number>;
  load: (
    steps: RouteStep[],
    titles: Map<string, string>,
    issueTexts: string[],
  ) => void;
  start: (fromRouteTime?: number) => void;
  close: () => void;
  toggle: () => void;
  detach: () => void;
  rejoin: () => void;
  seekRoute: (routeTime: number) => void;
  /** 跳过当前步骤（用于引导支线中手动结束访谈） */
  advanceStep: () => void;
  /** 每帧调用：由播放器时钟驱动主线媒体与支线本地时钟 */
  tick: (delta: number) => void;
}

let noticeSeq = 0;

export function createRoutePlayer(
  playback: Playback,
  cameraController: CameraController,
  branch: Branch,
): RoutePlayer {
  const mode = ref<PlayerMode>("idle");
  const playing = ref(false);
  const index = ref(0);
  const routeTime = ref(0);
  const notices = ref<RouteNotice[]>([]);
  const rejoinPoint = ref<{
    chapter: string;
    time: number;
    title: string;
  } | null>(null);

  let steps: RouteStep[] = [];
  let chapterTitles = new Map<string, string>();
  let branchClock = 0;
  let mainWatch = 0;
  let seenMarkers = new Set<string>();

  const current = computed(() => activeSteps(steps)[index.value]);
  const totalDuration = computed(() =>
    steps.reduce((sum, s) => sum + stepDuration(s), 0),
  );
  const progress = computed(() =>
    totalDuration.value === 0
      ? 0
      : Math.min(100, Math.round((routeTime.value / totalDuration.value) * 100)),
  );

  function notify(kind: RouteNotice["kind"], text: string) {
    const id = ++noticeSeq;
    notices.value = [...notices.value, { id, kind, text }];
    setTimeout(() => {
      notices.value = notices.value.filter((n) => n.id !== id);
    }, 5200);
  }

  function load(
    nextSteps: RouteStep[],
    titles: Map<string, string>,
    issueTexts: string[],
  ) {
    steps = nextSteps;
    chapterTitles = titles;
    seenMarkers = new Set();
    for (const text of issueTexts) notify("gap", text);
  }

  function enterStep(i: number) {
    const list = activeSteps(steps);
    index.value = i;
    const step = list[i];
    if (!step) {
      end();
      return;
    }
    routeTime.value = step.routeStart;
    if (step.kind === "gap") {
      notify("gap", step.reason);
      // gap 不占播放时长，直接衔接下一段，剩余路线保持不变
      enterStep(i + 1);
      return;
    }
    if (step.kind === "main") enterMain(step);
    else enterBranch(step);
  }

  function enterMain(step: MainStep) {
    if (playback.state.chapterId !== step.chapterId) {
      playback.select(step.chapterId);
    }
    playback.seek(step.srcStart);
    cameraController.restore(step.enterCamera);
    mainWatch = step.srcStart;
    for (const m of step.markers) {
      if (m.srcTime <= step.srcStart + 0.01 && !seenMarkers.has(m.hotspotId)) {
        seenMarkers.add(m.hotspotId);
        notify("marker", `打开热点：${m.title}`);
      }
    }
    playback.state.playing = playing.value;
  }

  function enterBranch(step: BranchStep) {
    const person = findPerson(step.personId);
    playback.state.playing = false;
    branchClock = 0;
    if (person) {
      const returnPoint: Position = {
        chapterId: step.returnChapterId,
        time: step.returnTime,
        camera: { ...step.returnCamera },
        playing: step.returnPlaying,
      };
      branch.enter(step.personId, returnPoint);
      branch.paragraph.value = 0;
      notify("info", `进入支线访谈：${person.name}（支线停留不计入主线）`);
    } else {
      notify("gap", `人物 ${step.personId} 已不存在，跳过该支线`);
      enterStep(index.value + 1);
    }
  }

  function tickMain(step: MainStep, delta: number) {
    mainWatch += delta;
    if (mainWatch >= step.srcEnd) {
      playback.seek(step.srcEnd);
      nextStep();
      return;
    }
    playback.seek(mainWatch);
    if (!detachHeld()) {
      const cam: Camera = cameraAt(step, mainWatch);
      cameraController.restore(cam);
    }
    for (const m of step.markers) {
      if (!seenMarkers.has(m.hotspotId) && mainWatch >= m.srcTime) {
        seenMarkers.add(m.hotspotId);
        notify("marker", `打开热点：${m.title}`);
      }
    }
    routeTime.value = step.routeStart + (mainWatch - step.srcStart);
  }

  function tickBranch(step: BranchStep, delta: number) {
    branchClock += delta;
    const person = findPerson(step.personId);
    if (person) {
      const per = step.visitElapsed / Math.max(1, person.paragraphs.length);
      const target = Math.min(
        person.paragraphs.length - 1,
        Math.floor(branchClock / Math.max(0.6, per)),
      );
      if (target !== branch.paragraph.value) branch.paragraph.value = target;
    }
    routeTime.value = step.routeStart + Math.min(branchClock, step.visitElapsed);
    if (branchClock >= step.visitElapsed) nextStep();
  }

  function detachHeld(): boolean {
    return mode.value === "detour";
  }

  function nextStep() {
    const list = activeSteps(steps);
    if (index.value + 1 >= list.length) {
      end();
      return;
    }
    enterStep(index.value + 1);
  }

  function end() {
    playing.value = false;
    mode.value = "idle";
    playback.state.playing = false;
    branch.leave();
    notify("info", "路线已播放完毕，可以自由继续探索");
  }

  function start(fromRouteTime = 0) {
    if (!steps.length) return;
    const found = locate(steps, fromRouteTime);
    mode.value = "guided";
    playing.value = true;
    rejoinPoint.value = null;
    if (found) {
      const list = activeSteps(steps);
      enterStep(list.indexOf(found.step));
      if (found.step.kind === "main") {
        mainWatch = found.step.srcStart + found.local;
        playback.seek(mainWatch);
      } else if (found.step.kind === "branch") {
        branchClock = found.local;
      }
      routeTime.value = fromRouteTime;
    } else {
      enterStep(0);
    }
  }

  function close() {
    mode.value = "idle";
    playing.value = false;
    branch.leave();
    playback.state.playing = false;
    rejoinPoint.value = null;
  }

  function toggle() {
    if (mode.value === "idle") return;
    playing.value = !playing.value;
    if (current.value?.kind === "main")
      playback.state.playing = playing.value;
  }

  /** 接收者随时脱离引导，进入自由探索；记录将要接续的位置 */
  function detach() {
    if (mode.value !== "guided") return;
    mode.value = "detour";
    playing.value = false;
    playback.state.playing = false;
    const step = current.value;
    if (step?.kind === "main") {
      rejoinPoint.value = {
        chapter: chapterTitles.get(step.chapterId) ?? step.chapterId,
        time: mainWatch,
        title: describeStep(step),
      };
    } else if (step?.kind === "branch") {
      rejoinPoint.value = {
        chapter: chapterTitles.get(step.returnChapterId) ?? step.returnChapterId,
        time: step.returnTime,
        title: describeStep(step),
      };
    }
    notify("info", "已脱离路线自由探索，随时可以从接续点回到路线");
  }

  /** 重新加入时先展示将接续的位置，确认后再恢复播放 */
  function rejoin() {
    if (mode.value !== "detour") return;
    const point = rejoinPoint.value;
    mode.value = "guided";
    if (point) {
      notify("info", `将接续：${point.title} · ${point.chapter}`);
      start(routeTime.value);
    } else {
      start(routeTime.value);
    }
  }

  function seekRoute(t: number) {
    if (mode.value === "idle") return;
    const wasPlaying = playing.value;
    branch.leave();
    start(t);
    playing.value = wasPlaying;
  }

  function advanceStep() {
    if (mode.value === "idle") return;
    branch.leave();
    nextStep();
  }

  function tick(delta: number) {
    if (mode.value === "idle" || !playing.value) return;
    const step = current.value;
    if (!step) return;
    if (step.kind === "main") tickMain(step, delta);
    else if (step.kind === "branch") tickBranch(step, delta);
  }

  function describeStep(step: RouteStep): string {
    if (step.kind === "main")
      return `主线 · ${chapterTitles.get(step.chapterId) ?? step.chapterId}`;
    if (step.kind === "branch")
      return `支线 · ${findPerson(step.personId)?.name ?? step.personId}`;
    return (step as GapStep).reason;
  }

  return {
    mode,
    playing,
    index,
    routeTime,
    current,
    notices,
    rejoinPoint,
    progress,
    totalDuration,
    load,
    start,
    close,
    toggle,
    detach,
    rejoin,
    seekRoute,
    advanceStep,
    tick,
  };
}
