<script setup lang="ts">
import { ref } from "vue";
import {
  Route as RouteIcon,
  Upload,
  Play,
  Pencil,
  Download,
  Trash2,
  Scissors,
  Clock,
} from "lucide-vue-next";
import { timecode } from "../../../shared/format";
import type { RouteLibrary } from "../model/library";
import type { Recorder } from "../model/recorder";
import { readRouteFile, downloadRoute } from "../lib/export";
import { resolveRoute } from "../lib/content";
import { reindex } from "../lib/timeline";

const props = defineProps<{
  library: RouteLibrary;
  recorder: Recorder;
}>();
const emit = defineEmits<{
  record: [];
  edit: [id: string];
  play: [id: string];
}>();

const importError = ref("");
const fileInput = ref<HTMLInputElement>();

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  importError.value = "";
  try {
    const parsed = await readRouteFile(file);
    const { steps } = resolveRoute(parsed);
    parsed.steps = reindex(steps);
    props.library.save(parsed);
  } catch (err) {
    importError.value =
      err instanceof Error ? `导入失败：${err.message}` : "导入失败";
  }
}
</script>

<template>
  <section class="routes-panel">
    <div class="panel-heading">
      <div>
        <small>SHAREABLE ROUTES</small>
        <h2>
          我的路线
          <em>{{ library.routes.value.length.toString().padStart(2, "0") }}</em>
        </h2>
      </div>
      <div class="heading-actions">
        <button class="text-button" @click="fileInput?.click()">
          <Upload :size="16" /> 导入路线
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          hidden
          @change="onImport"
        />
        <button class="route-btn primary" @click="emit('record')">
          <RouteIcon :size="15" /> 录制新路线
        </button>
      </div>
    </div>

    <p v-if="importError" class="import-error" role="alert">
      {{ importError }}
    </p>
    <p v-if="library.error.value" class="import-error" role="alert">
      {{ library.error.value }}
    </p>

    <div v-if="!library.routes.value.length" class="empty route-empty">
      <RouteIcon :size="34" />
      <h3>把一次自由探索，变成一条可分享的路线</h3>
      <p>
        录制你的主线进度、镜头运动与支线停留；剪掉等待后导出，朋友可以在另一台设备上按你的节奏播放，也能随时脱离。
      </p>
      <button class="route-btn primary" @click="emit('record')">
        <Scissors :size="15" /> 开始录制
      </button>
    </div>

    <article
      v-for="r in library.routes.value"
      :key="r.meta.id"
      class="route-card"
    >
      <div class="route-card-head">
        <h3>{{ r.meta.title }}</h3>
        <small>素材版本 {{ r.snapshot.contentVersion }}</small>
      </div>
      <div class="route-stats">
        <span><Clock :size="13" /> 主线 {{ timecode(r.meta.mainDuration) }}</span>
        <span>支线 {{ timecode(r.meta.branchDuration) }}</span>
        <span v-if="r.meta.trimmedDuration">
          已剪 {{ timecode(r.meta.trimmedDuration) }}
        </span>
        <span>{{ r.steps.length }} 个步骤</span>
      </div>
      <div class="route-card-actions">
        <button class="route-btn primary" @click="emit('play', r.meta.id)">
          <Play :size="14" /> 播放
        </button>
        <button class="route-btn" @click="emit('edit', r.meta.id)">
          <Pencil :size="14" /> 剪辑
        </button>
        <a
          class="route-btn"
          href="#"
          @click.prevent="downloadRoute(r)"
        >
          <Download :size="14" /> 导出
        </a>
        <button
          class="route-btn ghost"
          aria-label="删除路线"
          @click="library.remove(r.meta.id)"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </article>
  </section>
</template>
