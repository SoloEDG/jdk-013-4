import type { Camera } from "../../../shared/types";

/**
 * 路线（Route）数据模型。
 *
 * 一条路线由一串按「路线时间轴」排列的步骤（RouteStep）组成。
 * 主线步骤（main）只记录章节媒体时间，支线步骤（branch）拥有自己独立的
 * 本地时钟（visitElapsed），支线停留永远不会计入主线时长。
 */

export type RouteStepKind =
  | "main" // 主线片段：章节内的一段连续观看
  | "branch" // 支线片段：进入人物访谈后的停留
  | "gap"; // 裁剪或缺失素材造成的跳过说明（不产生播放动作）

interface StepBase {
  id: string;
  /** 路线时间轴上的开始时间（秒，裁剪后重新计算） */
  routeStart: number;
  /** 路线时间轴上的结束时间（秒） */
  routeEnd: number;
  /** 裁剪标记：被剪掉的步骤保留在原始数据中但不参与播放与导出 */
  removed?: boolean;
  /** gap 步骤的解释文案 */
  reason?: string;
}

export interface MainStep extends StepBase {
  kind: "main";
  chapterId: string;
  /** 章节媒体时间轴上的进入点 */
  srcStart: number;
  /** 章节媒体时间轴上的退出点 */
  srcEnd: number;
  /** 进入该片段时镜头应处的位置 */
  enterCamera: Camera;
  /** 片段内镜头关键帧（按 srcTime 升序），播放时在关键帧之间插值 */
  keys: CameraKey[];
}

export interface CameraKey {
  srcTime: number;
  camera: Camera;
}

/** 主线片段上的热点打开标记（用于预览时提示「打开了哪个热点」） */
export interface MainMarker {
  srcTime: number;
  hotspotId: string;
  title: string;
}

export interface MainStep extends StepBase {
  kind: "main";
  chapterId: string;
  /** 章节媒体时间轴上的进入点 */
  srcStart: number;
  /** 章节媒体时间轴上的退出点 */
  srcEnd: number;
  /** 进入该片段时镜头应处的位置 */
  enterCamera: Camera;
  /** 片段内镜头关键帧（按 srcTime 升序），播放时在关键帧之间插值 */
  keys: CameraKey[];
  /** 该片段内打开过的热点 */
  markers: MainMarker[];
}

export interface BranchStep extends StepBase {
  kind: "branch";
  personId: string;
  /** 进入支线时的主线位置，用于返回时重新衔接 */
  returnChapterId: string;
  returnTime: number;
  returnCamera: Camera;
  returnPlaying: boolean;
  /** 支线本地时钟：阅读到的段落与停留秒数，独立于主线 */
  visitElapsed: number;
  endParagraph: number;
  /** 支线内是否读到了最后一段（用于恢复时决定停留节奏） */
  finished: boolean;
}

export interface GapStep extends StepBase {
  kind: "gap";
  chapterId?: string;
  reason: string;
}

export type RouteStep = MainStep | BranchStep | GapStep;

export interface ContentSnapshot {
  /** 录制时内容包版本，接收端版本不同时触发兼容处理 */
  contentVersion: number;
  chapters: { id: string; title: string; duration: number }[];
  hotspots: { id: string; chapterId: string; personId?: string }[];
  people: { id: string; name: string; paragraphs: number }[];
}

export interface RouteMeta {
  id: string;
  title: string;
  /** 录制开始的墙上时间，仅用于展示 */
  createdAt: number;
  /** 录制时的应用/素材版本号 */
  schemaVersion: number;
  /** 主线总时长（不含支线，秒） */
  mainDuration: number;
  /** 支线总停留时长（秒），单独统计 */
  branchDuration: number;
  /** 裁剪总时长（秒） */
  trimmedDuration: number;
}

export interface RouteFile {
  format: "shoreline-route";
  meta: RouteMeta;
  snapshot: ContentSnapshot;
  steps: RouteStep[];
}

/** 录制器产出的原始事件，时间轴模型把它归并成步骤 */
export type RecEvent =
  | { type: "chapter"; at: number; chapterId: string; camera: Camera }
  | { type: "seek"; at: number; time: number; camera: Camera }
  | { type: "camera"; at: number; srcTime: number; camera: Camera }
  | { type: "hotspot"; at: number; hotspotId: string }
  | {
      type: "branch-enter";
      at: number;
      personId: string;
      returnChapterId: string;
      returnTime: number;
      returnCamera: Camera;
      returnPlaying: boolean;
    }
  | {
      type: "branch-leave";
      at: number;
      visitElapsed: number;
      endParagraph: number;
      finished: boolean;
    }
  | { type: "pause"; at: number }
  | { type: "resume"; at: number };
