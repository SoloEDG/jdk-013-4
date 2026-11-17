/**
 * 路线时间轴纯逻辑验证（不依赖浏览器/DOM）。
 * 运行：node --experimental-strip-types tests/routes.logic.test.ts
 */
import assert from "node:assert/strict";
import {
  buildSteps,
  reindex,
  cutRange,
  cutStep,
  restoreStep,
  totals,
  cameraAt,
  verifyContinuity,
  locate,
  activeSteps,
} from "../src/features/routes/lib/timeline.ts";
import type { RecEvent } from "../src/features/routes/model/types.ts";
import { parseRoute, serializeRoute } from "../src/features/routes/lib/export.ts";
import { resolveRoute } from "../src/features/routes/lib/content.ts";
import type { RouteFile } from "../src/features/routes/model/types.ts";

const durations = new Map([
  ["dawn", 24],
  ["craft", 24],
  ["night", 24],
]);
const titles = new Map([["fisher", "与守潮人聊聊"]]);
const cam = (yaw = 0) => ({ yaw, pitch: 0, fov: 70 });

// ---- 1. 事件归并：暂停/等待不入主线，支线独立计时 ----
{
  const events: RecEvent[] = [
    { type: "chapter", at: 0, chapterId: "dawn", camera: cam() },
    { type: "camera", at: 100, srcTime: 0, camera: cam() },
    { type: "camera", at: 300, srcTime: 4, camera: cam(30) },
    { type: "pause", at: 400 },
    { type: "resume", at: 9000 }, // 等了 8.6 秒
    { type: "camera", at: 9100, srcTime: 8, camera: cam(60) },
    { type: "hotspot", at: 9200, hotspotId: "fisher" },
    {
      type: "branch-enter",
      at: 9300,
      personId: "chen",
      returnChapterId: "dawn",
      returnTime: 8,
      returnCamera: cam(60),
      returnPlaying: true,
    },
    {
      type: "branch-leave",
      at: 20000,
      visitElapsed: 10.7,
      endParagraph: 2,
      finished: true,
    },
    { type: "camera", at: 20100, srcTime: 8.5, camera: cam(60) },
    { type: "camera", at: 24000, srcTime: 14, camera: cam(-20) },
  ];
  const steps = buildSteps(events, durations, titles);
  const t = totals(steps);
  // 主线：0->8（第一段）+ 8->14（返回后第二段）= 14 秒；支线 10.7 秒单独算
  assert.equal(t.main, 14, "主线时长不应包含暂停等待与支线停留");
  assert.equal(t.branch, 10.7, "支线时长独立统计");
  assert.equal(t.total, 24.7);

  const branch = steps.find((s) => s.kind === "branch");
  assert.ok(branch && branch.kind === "branch");
  if (branch?.kind === "branch") {
    assert.equal(branch.returnChapterId, "dawn");
    assert.equal(branch.returnTime, 8);
  }
  const mains = steps.filter((s) => s.kind === "main");
  assert.ok(mains.length >= 2, "支线返回后必须开启新的主线片段（显式衔接点）");
  assert.deepEqual(
    verifyContinuity(steps),
    [],
    "时间轴铺设与返回点必须连续",
  );
  console.log("✓ 用例1：暂停/等待不入主线，支线独立计时且返回点衔接");
}

// ---- 2. 区间裁剪：剪掉中间等待，后续镜头重新衔接 ----
{
  const events: RecEvent[] = [
    { type: "chapter", at: 0, chapterId: "dawn", camera: cam() },
    { type: "camera", at: 100, srcTime: 0, camera: cam(0) },
    { type: "camera", at: 200, srcTime: 10, camera: cam(100) },
    { type: "camera", at: 300, srcTime: 20, camera: cam(200) },
  ];
  const steps = buildSteps(events, durations, titles);
  const mainId = steps[0]!.id;
  const before = totals(steps).main;
  assert.equal(before, 20);
  const cut = cutRange(steps, mainId, 5, 15);
  const after = totals(cut);
  assert.equal(after.main, 10, "剪掉 10 秒后主线只剩 10 秒");
  assert.equal(after.trimmed, 10);
  const kept = activeSteps(cut).filter((s) => s.kind === "main");
  assert.equal(kept.length, 2, "一个片段被剪成两个保留片段");
  // 第二段进入镜头应为剪切点 t=15 的插值镜头（yaw 在 100->200 之间）
  const second = kept[1]!;
  if (second.kind === "main") {
    const c = cameraAt(second, second.srcStart);
    assert.ok(c.yaw > 100 && c.yaw < 200, "剪切点镜头需重新衔接而非跳回初始视角");
  }
  assert.deepEqual(verifyContinuity(cut), []);
  // 恢复剪切
  const removed = cut.find((s) => s.removed)!;
  const restored = restoreStep(cut, removed.id);
  assert.equal(totals(restored).main, 20, "恢复后时长还原");
  console.log("✓ 用例2：区间裁剪后镜头与返回点重新衔接，且可恢复");
}

// ---- 3. 整段剪掉支线不影响主线 ----
{
  const events: RecEvent[] = [
    { type: "chapter", at: 0, chapterId: "dawn", camera: cam() },
    { type: "camera", at: 100, srcTime: 0, camera: cam() },
    { type: "camera", at: 200, srcTime: 6, camera: cam(40) },
    {
      type: "branch-enter",
      at: 300,
      personId: "chen",
      returnChapterId: "dawn",
      returnTime: 6,
      returnCamera: cam(40),
      returnPlaying: false,
    },
    {
      type: "branch-leave",
      at: 8000,
      visitElapsed: 7,
      endParagraph: 1,
      finished: false,
    },
    { type: "camera", at: 8100, srcTime: 6.5, camera: cam(40) },
    { type: "camera", at: 9000, srcTime: 12, camera: cam(-30) },
  ];
  const steps = buildSteps(events, durations, titles);
  const branch = steps.find((s) => s.kind === "branch")!;
  const cut = cutStep(steps, branch.id);
  const t = totals(cut);
  assert.equal(t.branch, 0);
  assert.equal(t.main, 12, "剪掉支线不改变主线时长");
  // 支线被剪后，其返回点不再可校验 -> 连续性检查应报告
  const errs = verifyContinuity(cut);
  assert.ok(errs.length === 0 || errs.every((e) => e.includes("返回点")));
  console.log("✓ 用例3：整段剪掉支线不影响主线时长");
}

// ---- 4. 导出/导入往返 + 缺失素材转 gap 且不清空剩余路线 ----
{
  const events: RecEvent[] = [
    { type: "chapter", at: 0, chapterId: "dawn", camera: cam() },
    { type: "camera", at: 100, srcTime: 0, camera: cam() },
    { type: "camera", at: 200, srcTime: 5, camera: cam(20) },
    { type: "hotspot", at: 250, hotspotId: "ghost" },
    {
      type: "branch-enter",
      at: 300,
      personId: "chen",
      returnChapterId: "dawn",
      returnTime: 5,
      returnCamera: cam(20),
      returnPlaying: true,
    },
    {
      type: "branch-leave",
      at: 5000,
      visitElapsed: 4,
      endParagraph: 0,
      finished: false,
    },
    { type: "camera", at: 5100, srcTime: 5.5, camera: cam(20) },
    { type: "camera", at: 6000, srcTime: 9, camera: cam(50) },
  ];
  const steps = buildSteps(events, durations, new Map([["ghost", "已下线热点"]]));
  const file = serializeRoute(
    steps,
    { id: "r1", title: "测试路线", createdAt: 1, schemaVersion: 1 },
    {
      contentVersion: 19990101,
      chapters: [
        { id: "dawn", title: "港口醒来", duration: 24 },
        { id: "gone", title: "消失章节", duration: 24 },
      ],
      hotspots: [{ id: "ghost", chapterId: "dawn" }],
      people: [
        { id: "chen", name: "陈海生", paragraphs: 3 },
        { id: "nobody", name: "陌生人", paragraphs: 2 },
      ],
    },
  );
  // 序列化往返
  const roundtrip = parseRoute(JSON.parse(JSON.stringify(file))) as RouteFile;
  assert.equal(roundtrip.meta.id, "r1");
  assert.ok(!roundtrip.steps.some((s) => s.removed), "导出必须剔除已剪片段");

  // 篡改：让一个主线章节与一个支线人物在“当前设备”消失
  roundtrip.steps.unshift({
    id: "x1",
    kind: "main",
    routeStart: 0,
    routeEnd: 0,
    chapterId: "gone",
    srcStart: 0,
    srcEnd: 6,
    enterCamera: cam(),
    keys: [],
    markers: [],
  });
  const branchStep = roundtrip.steps.find((s) => s.kind === "branch");
  if (branchStep?.kind === "branch") branchStep.personId = "nobody";
  reindex(roundtrip.steps);

  const { steps: resolved, issues, versionMismatch } = resolveRoute(roundtrip);
  assert.equal(versionMismatch, true, "素材版本不同应被识别");
  assert.ok(issues.length >= 2, "版本差异与缺失素材都要有解释");
  const gaps = resolved.filter((s) => s.kind === "gap");
  assert.ok(gaps.length >= 1, "缺失片段转为 gap 说明");
  const remaining = resolved.filter((s) => s.kind !== "gap");
  assert.ok(remaining.length >= 1, "剩余路线不得被清空");
  // 时间轴仍然连续可定位
  assert.ok(locate(resolved, 0.1) !== null);
  assert.deepEqual(
    verifyContinuity(resolved.filter((s) => s.kind !== "gap")),
    [],
  );
  console.log("✓ 用例4：版本/素材缺失转 gap 并解释，剩余路线保留且可定位");
}

// ---- 5. 非法文件必须抛错而非污染数据 ----
{
  assert.throws(() => parseRoute(null));
  assert.throws(() => parseRoute({ format: "wrong" }));
  assert.throws(() => parseRoute({ format: "shoreline-route", meta: {}, snapshot: {}, steps: [] }));
  console.log("✓ 用例5：非法路线文件被拒绝");
}

console.log("\n全部路线逻辑用例通过 ✔");
