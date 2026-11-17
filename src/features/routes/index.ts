export { createRecorder } from "./model/recorder";
export type { Recorder } from "./model/recorder";
export { createRoutePlayer } from "./model/player";
export type { RoutePlayer, PlayerMode, RouteNotice } from "./model/player";
export { createRouteLibrary } from "./model/library";
export type { RouteLibrary } from "./model/library";
export {
  buildSteps,
  reindex,
  activeSteps,
  cutRange,
  cutStep,
  restoreStep,
  totals,
  cameraAt,
  locate,
  verifyContinuity,
  stepDuration,
} from "./lib/timeline";
export {
  buildSnapshot,
  resolveRoute,
  chapterTitleOf,
  personNameOf,
  CURRENT_CONTENT_VERSION,
} from "./lib/content";
export type { ResolveIssue } from "./lib/content";
export {
  serializeRoute,
  parseRoute,
  readRouteFile,
  downloadRoute,
} from "./lib/export";
export { default as RecorderBar } from "./ui/RecorderBar.vue";
export { default as RoutesPanel } from "./ui/RoutesPanel.vue";
export { default as RouteEditor } from "./ui/RouteEditor.vue";
export { default as RoutePlayerBar } from "./ui/RoutePlayerBar.vue";
export { default as RouteNotices } from "./ui/RouteNotices.vue";
export type {
  RouteFile,
  RouteStep,
  MainStep,
  BranchStep,
  GapStep,
  RouteMeta,
  CameraKey,
  MainMarker,
} from "./model/types";
