<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  ArrowLeft,
  Scissors,
  RotateCcw,
  Save,
  Download,
  Play,
  Film,
  UserRound,
  TriangleAlert,
  CheckCircle2,
} from "lucide-vue-next";
import { timecode } from "../../../shared/format";
import type { RouteFile, RouteStep, MainStep, BranchStep } from "../model/types";
import {
  totals,
  cutRange,
  cutStep,
  restoreStep,
  verifyContinuity,
  activeSteps,
} from "../lib/timeline";
import {
  chapterTitleOf,
  personNameOf,
} from "../lib/content";
import { downloadRoute, serializeRoute } from "../lib/export";
import { buildSnapshot } from "../lib/content";

const props = defineProps<{ route: RouteFile }>();
const emit = defineEmits<{
  back: [];
  saved: [file: RouteFile];
  play: [];
}>();

const steps = reactive<RouteStep[]>(structuredClone(props.route.steps));
const title = ref(props.route.meta.title);
const cutFrom = reactive<Record<string, number>>({});
const cutTo = reactive<Record<string, number>>({});

watch(
  () => props.route.meta.id,
  () => {
    steps.splice(0, steps.length, ...structuredClone(props.route.steps));
    title.value = props.route.meta.title;
  },
);

const stats = computed(() => totals(steps));
const errors = computed(() => verifyContinuity(steps));
const visible = computed(() =>
  steps.map((s, i) => ({ step: s, index: i })),
);

function label(s: RouteStep): string {
  if (s.kind === "main") return chapterTitleOf(props.route, s.chapterId);
  if (s.kind === "branch") return `访谈 · ${personNameOf(props.route, s.personId)}`;
  return s.reason;
}

function stepLength(s: RouteStep): number {
  if (s.kind === "main") return s.srcEnd - s.srcStart;
  if (s.kind === "branch") return s.visitElapsed;
  return 0;
}

function rangeOptions(step: MainStep) {
  const out: number[] = [];
  for (let t = step.srcStart; t <= step.srcEnd + 0.001; t += 1) {
    out.push(Math.min(t, step.srcEnd));
  }
  return out;
}

function ensureRange(step: MainStep) {
  if (cutFrom[step.id] === undefined) cutFrom[step.id] = step.srcStart;
  if (cutTo[step.id] === undefined) cutTo[step.id] = step.srcEnd;
}

function applyRange(step: MainStep) {
  ensureRange(step);
  const next = cutRange(steps, step.id, cutFrom[step.id]!, cutTo[step.id]!);
  steps.splice(0, steps.length, ...next);
}

function removeStep(s: RouteStep) {
  const next = cutStep(steps, s.id);
  steps.splice(0, steps.length, ...next);
}

function undoRemove(s: RouteStep) {
  const next = restoreStep(steps, s.id);
  steps.splice(0, steps.length, ...next);
}

function buildFile(): RouteFile {
  return serializeRoute(
    steps,
    {
      id: props.route.meta.id,
      title: title.value.trim() || "未命名路线",
      createdAt: props.route.meta.createdAt,
      schemaVersion: props.route.meta.schemaVersion,
    },
    buildSnapshot(),
  );
}

function save() {
  emit("saved", buildFile());
}

function exportFile() {
  downloadRoute(buildFile());
}

const activeCount = computed(() => activeSteps(steps).length);
</script>

<template>
  <section class="route-editor">
    <div class="panel-heading">
      <div>
        <button class="text-button" @click="emit('back')">
          <ArrowLeft :size="16" /> 返回路线列表
        </button>
        <h2>
          <input
            v-model="title"
            class="route-title-input"
            aria-label="路线名称"
            maxlength="40"
          />
        </h2>
      </div>
      <div class="heading-actions">
        <button class="route-btn" :disabled="!!errors.length" @click="emit('play')">
          <Play :size="14" /> 预览
        </button>
        <button class="route-btn" @click="exportFile">
          <Download :size="14" /> 导出
        </button>
        <button class="route-btn primary" @click="save">
          <Save :size="14" /> 保存修改
        </button>
      </div>
    </div>

    <div class="editor-summary">
      <div class="summary-item main">
        <Film :size="16" />
        <div>
          <small>主线时长（不含支线）</small>
          <strong>{{ timecode(stats.main) }}</strong>
        </div>
      </div>
      <div class="summary-item branch">
        <UserRound :size="16" />
        <div>
          <small>支线停留（独立时钟）</small>
          <strong>{{ timecode(stats.branch) }}</strong>
        </div>
      </div>
      <div class="summary-item trim">
        <Scissors :size="16" />
        <div>
          <small>已剪掉的等待</small>
          <strong>{{ timecode(stats.trimmed) }}</strong>
        </div>
      </div>
      <div class="summary-check" :class="{ bad: errors.length }">
        <TriangleAlert v-if="errors.length" :size="16" />
        <CheckCircle2 v-else :size="16" />
        <span v-if="errors.length">{{ errors[0] }}</span>
        <span v-else>衔接检查通过 · {{ activeCount }} 个有效步骤</span>
      </div>
    </div>

    <div class="step-list">
      <article
        v-for="{ step, index } in visible"
        :key="step.id"
        class="step-row"
        :class="[step.kind, { removed: step.removed }]"
      >
        <div class="step-index">{{ String(index + 1).padStart(2, "0") }}</div>
        <div class="step-icon">
          <Film v-if="step.kind === 'main'" :size="17" />
          <UserRound v-else-if="step.kind === 'branch'" :size="17" />
          <TriangleAlert v-else :size="17" />
        </div>
        <div class="step-body">
          <div class="step-head">
            <h3>{{ label(step) }}</h3>
            <span class="step-kind">
              {{
                step.kind === "main"
                  ? "主线片段"
                  : step.kind === "branch"
                    ? "支线访谈"
                    : "跳过说明"
              }}
            </span>
            <small v-if="!step.removed" class="step-length">
              {{ timecode(stepLength(step)) }}
            </small>
          </div>

          <template v-if="step.kind === 'main' && !step.removed">
            <p class="step-range">
              源时间 {{ timecode(step.srcStart) }} →
              {{ timecode(step.srcEnd) }} ·
              {{ step.keys.length }} 个镜头关键帧 ·
              {{ step.markers.length }} 个热点标记
            </p>
            <div class="cut-row">
              <label>
                从
                <select
                  v-model="cutFrom[step.id]"
                  @focus="ensureRange(step)"
                >
                  <option v-for="t in rangeOptions(step)" :key="t" :value="t">
                    {{ timecode(t) }}
                  </option>
                </select>
              </label>
              <label>
                到
                <select v-model="cutTo[step.id]" @focus="ensureRange(step)">
                  <option v-for="t in rangeOptions(step)" :key="t" :value="t">
                    {{ timecode(t) }}
                  </option>
                </select>
              </label>
              <button class="route-btn" @click="applyRange(step)">
                <Scissors :size="13" /> 剪掉这段等待
              </button>
            </div>
          </template>

          <template v-else-if="step.kind === 'branch' && !step.removed">
            <p class="step-range">
              停留 {{ timecode(step.visitElapsed) }} · 读到第
              {{ step.endParagraph + 1 }} 段 · 返回
              {{ chapterTitleOf(props.route, step.returnChapterId) }}
              {{ timecode(step.returnTime) }}（返回点保持衔接）
            </p>
          </template>

          <p v-else-if="step.removed" class="step-range removed-note">
            已剪掉：{{ timecode(stepLength(step)) }}（原始数据保留，可恢复）
          </p>
          <p v-else class="step-range">{{ step.reason }}</p>
        </div>

        <div class="step-ops">
          <button
            v-if="step.removed"
            class="route-btn"
            @click="undoRemove(step)"
          >
            <RotateCcw :size="13" /> 恢复
          </button>
          <button
            v-else-if="step.kind !== 'gap'"
            class="route-btn ghost"
            aria-label="整段剪掉"
            @click="removeStep(step)"
          >
            <Scissors :size="14" /> 整段剪
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
