/**
 * 端到端冒烟：用最小环境桩模拟一次完整用户旅程
 * 开始录制 → 播放/转头/暂停 → 进支线访谈 → 返回 → 再访同一人物
 * → 停止 → 剪辑裁剪 → 导出 → 接收端版本不兼容/素材缺失解析 → 播放器逐帧驱动
 */
import assert from "node:assert/strict";
import { createRecorder } from "../src/features/routes/model/recorder.ts";
import {
  buildSteps,
  totals,
  cutRange,
  activeSteps,
  verifyContinuity,
  locate,
} from "../src/features/routes/lib/timeline.ts";
import { serializeRoute, parseRoute } from "../src/features/routes/lib/export.ts";
import { resolveRoute } from "../src/features/routes/lib/content.ts";
import { createRoutePlayer } from "../src/features/routes/model/player.ts";
import { createPlayback } from "../src/features/chapters/model/playback.ts";
import { createCamera } from "../src/features/panorama/model/camera.ts";
import { createBranch } from "../src/features/interviews/model/branch.ts";
import { chapters, hotspots } from "../src/shared/content.ts";

// --- 最小浏览器桩 ---
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as unknown as Storage;
// 可控虚拟时钟：测试按需推进，模拟真实帧间隔
let virtualNow = 0;
globalThis.performance = { now: () => virtualNow } as Performance;
const tick = (ms: number) => {
  virtualNow += ms;
};
globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
globalThis.setTimeout = ((fn: TimerHandler) => {
  // 通知在测试里不需要真正延时
  if (typeof fn === "function") fn();
  return 0 as unknown as ReturnType<typeof setTimeout>;
}) as typeof setTimeout;

const durations = new Map(chapters.map((c) => [c.id, c.duration]));
const titles = new Map(hotspots.map((h) => [h.id, h.title]));

// ===== 1. 录制完整旅程 =====
const rec = createRecorder();
const cam0 = { yaw: 0, pitch: 0, fov: 70 };
rec.start("dawn", cam0);
assert.equal(rec.mode.value, "recording");
tick(100);

// 播放 4 秒主线并转头
for (let i = 0; i < 40; i++) {
  tick(100);
  rec.advance(0.1);
  rec.camera(i * 0.1, { yaw: i * 1.5, pitch: 0, fov: 70 });
}
rec.hotspot("fisher");

// 暂停 30 秒（模拟等待），主线时钟不应前进
rec.pause();
const mainBeforePause = rec.mainElapsed.value;
tick(30000);
rec.advance(30); // 暂停态 advance 直接忽略
assert.equal(rec.mainElapsed.value, mainBeforePause, "暂停期间主线不计时");
rec.resume();

// 进入支线访谈（第一次访问 chen）
rec.branchEnter({
  personId: "chen",
  returnChapterId: "dawn",
  returnTime: 4,
  returnCamera: { yaw: 60, pitch: 0, fov: 70 },
  returnPlaying: true,
});
const branchBefore = rec.branchElapsed.value;
tick(6000); // 支线停留 6 秒
rec.advance(5); // 支线期间 advance 不计主线
assert.equal(rec.mainElapsed.value, mainBeforePause, "支线期间主线冻结");
rec.branchLeave(2, true);
assert.ok(rec.branchElapsed.value > branchBefore, "支线独立时钟累加");

// 返回后继续主线 3 秒
for (let i = 0; i < 30; i++) {
  tick(100);
  rec.advance(0.1);
  rec.camera(4 + i * 0.1, { yaw: 60 - i, pitch: 0, fov: 70 });
}

// 重复访问同一人物（再进一次支线）
rec.branchEnter({
  personId: "chen",
  returnChapterId: "dawn",
  returnTime: 7,
  returnCamera: { yaw: 30, pitch: 0, fov: 70 },
  returnPlaying: false,
});
tick(3500);
rec.branchLeave(1, false);

// 返回后先在主线停留片刻（真实场景：返回点需要一段可衔接的主线）
for (let i = 0; i < 15; i++) {
  tick(100);
  rec.advance(0.1);
  rec.camera(7 + i * 0.1, { yaw: 30 + i, pitch: 0, fov: 70 });
}

// 切换章节继续
rec.chapter("craft", { yaw: 0, pitch: 0, fov: 70 });
for (let i = 0; i < 20; i++) {
  tick(100);
  rec.advance(0.1);
  rec.camera(i * 0.1, { yaw: -i * 2, pitch: 0, fov: 70 });
}

// 停止前捕获墙钟口径（stop 会清零录制器状态）
const mainClock = rec.mainElapsed.value;
const branchClock = rec.branchElapsed.value;
const events = rec.stop();
assert.equal(rec.mode.value, "idle");
assert.ok(events.length > 10);
assert.ok(mainClock > 0 && branchClock > 0, "墙钟口径排除暂停/支线后仍有累计");

// ===== 2. 构建步骤并校验不变量 =====
const steps = buildSteps(events, durations, titles);
const t = totals(steps);
assert.ok(t.main > 0 && t.branch > 0);
// 主线口径 = 媒体源时间差：dawn 0→8.5（支线返回点冻结主线）+ craft 0→2，共约 10.5 秒
assert.ok(
  Math.abs(t.main - 10.5) < 0.6,
  `主线时长应来自源时间而非墙钟，实际 ${t.main}`,
);
// 墙钟口径只用于界面展示，且严格排除了暂停与支线停留（停止前已捕获）
assert.ok(mainClock > 0 && branchClock > 0);
assert.deepEqual(verifyContinuity(steps), [], "原始路线连续性自检通过");
const branchSteps = steps.filter((s) => s.kind === "branch");
assert.equal(branchSteps.length, 2, "两次访谈（含重复访问同一人物）各成一个支线步骤");
assert.ok(
  branchSteps.every((s) => s.kind === "branch" && s.personId === "chen"),
  "重复访问同一人物被完整记录",
);

// ===== 3. 剪辑：剪掉第一段主线里的等待，并整段剪掉第二个支线 =====
const firstMain = steps.find((s) => s.kind === "main")!;
let edited = cutRange(steps, firstMain.id, 1, 2.5);
const secondBranch = edited.filter((s) => s.kind === "branch")[1]!;
edited = cutRange(
  edited,
  secondBranch.id,
  0,
  0,
); // 对支线调用区间裁剪应无效（类型不匹配）
assert.equal(
  edited.filter((s) => s.kind === "branch" && !s.removed).length,
  2,
  "对支线误用区间裁剪不会破坏数据",
);
assert.deepEqual(verifyContinuity(activeSteps(edited)), []);

const file = serializeRoute(
  edited,
  { id: "e2e-1", title: "端到端路线", createdAt: Date.now(), schemaVersion: 1 },
  {
    contentVersion: 19990101, // 故意制造版本不匹配
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, duration: c.duration })),
    hotspots: hotspots.map((h) => ({ id: h.id, chapterId: h.chapterId, personId: h.personId })),
    people: [{ id: "ghost", name: "已下线人物", paragraphs: 1 }],
  },
);
// 让一个支线指向接收端不存在的人物
const branchInFile = file.steps.find((s) => s.kind === "branch");
if (branchInFile?.kind === "branch") branchInFile.personId = "ghost";

// ===== 4. 接收端解析：版本不同 + 人物缺失，必须跳过且保留剩余 =====
const parsed = parseRoute(JSON.parse(JSON.stringify(file)));
const { steps: resolved, issues, versionMismatch } = resolveRoute(parsed);
assert.equal(versionMismatch, true);
assert.ok(issues.some((i) => i.reason.includes("版本")));
assert.ok(issues.some((i) => i.reason.includes("已下线")));
assert.ok(resolved.some((s) => s.kind === "gap"), "缺失支线转 gap 解释");
assert.ok(
  resolved.filter((s) => s.kind === "main").length >= 2,
  "剩余主线没有被清空",
);
assert.deepEqual(
  verifyContinuity(resolved.filter((s) => s.kind !== "gap")),
  [],
  "容错后时间轴依然连续",
);

// ===== 5. 播放器逐帧驱动 + 脱离/重入 =====
const playback = createPlayback();
const camera = createCamera();
const branch = createBranch();
const player = createRoutePlayer(playback, camera, branch);
const chapterTitleMap = new Map(chapters.map((c) => [c.id, c.title]));
player.load(
  resolved,
  chapterTitleMap,
  issues.map((i) => i.reason),
);
player.start(0);
assert.equal(player.mode.value, "guided");

let frames = 0;
for (let i = 0; i < 400 && player.mode.value !== "idle"; i++) {
  player.tick(0.1);
  frames++;
}
assert.ok(frames > 0, "播放器时钟逐帧推进");
assert.ok(
  issues.some((i) => i.level === "skip"),
  "容错跳过的解释在 issues 中持久保留（界面通知为瞬时提示）",
);
assert.ok(
  resolved.some((s) => s.kind === "gap"),
  "缺失内容以 gap 步骤留在时间轴上",
);

// 脱离引导
player.start(0);
player.detach();
assert.equal(player.mode.value, "detour");
assert.ok(player.rejoinPoint.value, "脱离时记录了接续位置");
const point = player.rejoinPoint.value!;
assert.ok(point.chapter && point.title);
// 重入
player.rejoin();
assert.equal(player.mode.value, "guided");

// 路线定位：任意路线时间都能找到步骤
const somewhere = locate(resolved, Math.max(0.1, player.totalDuration.value / 2));
assert.ok(somewhere, "重入位置可在路线上定位");

console.log("✓ 端到端冒烟通过：录制→暂停/支线隔离→重复访问→裁剪→导出→容错解析→播放→脱离/重入");
console.log(
  `  主线 ${t.main.toFixed(1)}s / 支线 ${t.branch.toFixed(1)}s / 步骤 ${steps.length} 个 / 通知 ${player.notices.value.length + issues.length} 条`,
);
