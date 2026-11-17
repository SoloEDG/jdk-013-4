import { ref } from "vue";
import { createCamera } from "../features/panorama";
import { createPlayback } from "../features/chapters";
import { createDiscovery } from "../features/hotspots";
import { createBranch } from "../features/interviews";
import { createJournal } from "../features/journal";
import {
  createRecorder,
  createRoutePlayer,
  createRouteLibrary,
  buildSteps,
  buildSnapshot,
  resolveRoute,
  serializeRoute,
} from "../features/routes";
import { chapters, hotspots } from "../shared/content";
import type { Command, Position } from "../shared/types";
import type { RouteFile } from "../features/routes";

const SCHEMA_VERSION = 1;

export function createWorkspace() {
  const camera = createCamera(),
    playback = createPlayback(),
    discovery = createDiscovery(() => playback.state),
    branch = createBranch(),
    journal = createJournal(),
    recorder = createRecorder(),
    library = createRouteLibrary(),
    player = createRoutePlayer(playback, camera, branch),
    tab = ref<"story" | "journal" | "routes">("story");

  /** 剪辑器当前打开的路线 id */
  const editingRouteId = ref<string | null>(null);
  const editingFile = ref<RouteFile | null>(null);
  /** 播放中的路线文件（用于取素材快照标题） */
  const playingFile = ref<RouteFile | null>(null);
  /** 编辑器里尚未保存、但要求直接预览的路线 */
  const previewFile = ref<RouteFile | null>(null);

  const position = (): Position => ({
    chapterId: playback.state.chapterId,
    time: playback.state.time,
    camera: { ...camera.camera },
    playing: playback.state.playing,
  });

  /** 引导播放中，自由交互（章节切换、热点、拖动以外的指令）需要被收束 */
  const guided = () => player.mode.value === "guided";

  function enterPerson(id: string) {
    if (guided()) return;
    const pos = position();
    branch.enter(id, pos);
    playback.state.playing = false;
    discovery.close();
    if (recorder.mode.value === "recording") {
      recorder.branchEnter({
        personId: id,
        returnChapterId: pos.chapterId,
        returnTime: pos.time,
        returnCamera: pos.camera,
        returnPlaying: pos.playing,
      });
    }
  }

  /** 结束支线访谈：录制中结算支线时钟，并在返回点重新衔接主线 */
  function leaveBranch(paragraph: number, finished: boolean) {
    const saved = branch.leave();
    if (recorder.mode.value === "recording") {
      recorder.branchLeave(paragraph, finished);
    }
    if (saved) {
      playback.select(saved.chapterId);
      playback.seek(saved.time);
      camera.restore(saved.camera);
      playback.state.playing = saved.playing;
    }
  }

  function dispatch(command: Command) {
    if (guided() && command.type !== "revisit") return;
    switch (command.type) {
      case "chapter":
        if (branch.personId.value) return;
        playback.select(command.id);
        camera.reset();
        discovery.close();
        if (recorder.mode.value === "recording")
          recorder.chapter(command.id, { ...camera.camera });
        break;
      case "seek":
        playback.seek(command.time);
        if (recorder.mode.value === "recording")
          recorder.seek(command.time, { ...camera.camera });
        break;
      case "hotspot":
        discovery.select(command.id);
        if (recorder.mode.value === "recording") recorder.hotspot(command.id);
        break;
      case "return":
        leaveBranch(branch.paragraph.value, false);
        break;
      case "revisit":
        // 统一走支线结算，避免录制器的支线状态泄漏到后续主线
        leaveBranch(branch.paragraph.value, false);
        playback.select(command.entry.chapterId);
        playback.seek(command.entry.time);
        camera.restore(command.entry.camera);
        discovery.select(command.entry.hotspotId);
        tab.value = "story";
        break;
    }
  }

  function save() {
    const h = discovery.detail.value;
    if (h) journal.save(h, position());
  }

  /* ---------------- 路线录制 ---------------- */

  function startRecording() {
    tab.value = "story";
    playback.select(playback.state.chapterId);
    camera.reset();
    recorder.start(playback.state.chapterId, { ...camera.camera });
  }

  function stopRecording() {
    const events = recorder.stop();
    const durations = new Map(chapters.map((c) => [c.id, c.duration]));
    const titles = new Map(hotspots.map((h) => [h.id, h.title]));
    const steps = buildSteps(events, durations, titles);
    if (!steps.length) return;
    const file = serializeRoute(
      steps,
      {
        id: crypto.randomUUID(),
        title: `我的路线 · ${new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        createdAt: Date.now(),
        schemaVersion: SCHEMA_VERSION,
      },
      buildSnapshot(),
    );
    library.save(file);
    openEditor(file.meta.id);
  }

  function discardRecording() {
    recorder.discard();
  }

  function openEditor(id: string) {
    const file = library.routes.value.find((r) => r.meta.id === id);
    if (!file) return;
    editingRouteId.value = id;
    editingFile.value = file;
    tab.value = "routes";
  }

  function closeEditor() {
    editingRouteId.value = null;
    editingFile.value = null;
  }

  function saveEdited(file: RouteFile) {
    library.replace(file);
    editingFile.value = file;
  }

  /* ---------------- 路线播放 ---------------- */

  function playRoute(id: string, override?: RouteFile) {
    const stored =
      override ??
      previewFile.value ??
      library.routes.value.find((r) => r.meta.id === id);
    if (!stored) return;
    previewFile.value = null;
    const { steps, issues } = resolveRoute(stored);
    const file: RouteFile = { ...stored, steps };
    playingFile.value = file;
    tab.value = "story";
    discovery.close();
    branch.leave();
    const titles = new Map(
      chapters.map((c) => [c.id, c.title]),
    );
    player.load(
      steps,
      titles,
      issues.map((i) => i.reason),
    );
    player.start(0);
  }

  function closePlayer() {
    player.close();
    playingFile.value = null;
  }

  /** 引导中的支线「返回主线」由播放器推进到下一路线步骤 */
  function guidedBack() {
    player.advanceStep();
  }

  /* ---------------- 帧循环 ---------------- */

  let lastFrame = 0;
  function frame(now: number) {
    const delta = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (delta > 0) {
      if (recorder.mode.value === "recording") {
        if (playback.state.playing && !branch.personId.value) {
          recorder.advance(delta);
        }
        recorder.camera(playback.state.time, { ...camera.camera });
      }
      if (player.mode.value !== "idle") player.tick(delta);
    }
    requestAnimationFrame(frame);
  }
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(frame);

  return {
    camera,
    playback,
    discovery,
    branch,
    journal,
    recorder,
    library,
    player,
    tab,
    editingRouteId,
    editingFile,
    playingFile,
    position,
    guided,
    enterPerson,
    leaveBranch,
    dispatch,
    save,
    startRecording,
    stopRecording,
    discardRecording,
    openEditor,
    closeEditor,
    saveEdited,
    previewFile,
    playRoute,
    closePlayer,
    guidedBack,
  };
}
