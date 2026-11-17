<script setup lang="ts">
import { Circle, Pause, Play, Square, Trash2 } from "lucide-vue-next";
import { timecode } from "../../../shared/format";
import type { Recorder } from "../model/recorder";

const props = defineProps<{ recorder: Recorder }>();
const emit = defineEmits<{
  start: [];
  pause: [];
  resume: [];
  stop: [];
  discard: [];
}>();

const idle = () => props.recorder.mode.value === "idle";
const recording = () => props.recorder.mode.value === "recording";
const paused = () => props.recorder.mode.value === "paused";
</script>

<template>
  <div class="recorder-bar" :class="{ paused: paused() }">
    <div class="rec-status">
      <span class="rec-dot" :class="{ blink: recording() }">
        <Circle :size="11" :fill="recording() ? '#e07a6e' : 'none'" />
      </span>
      <div>
        <strong>{{
          idle()
            ? "路线录制"
            : paused()
              ? "录制已暂停"
              : "正在录制路线"
        }}</strong>
        <small v-if="!idle()">
          已录 {{ timecode(recorder.wall.value) }} · 主线
          {{ timecode(recorder.mainElapsed.value) }} / 支线
          {{ timecode(recorder.branchElapsed.value) }} ·
          {{ recorder.eventCount.value }} 个动作
        </small>
        <small v-else>开始后，转头、热点与访谈都会成为可分享的路线步骤</small>
      </div>
    </div>
    <div class="rec-actions">
      <button v-if="idle()" class="route-btn primary" @click="emit('start')">
        <Circle :size="14" /> 开始录制
      </button>
      <template v-else>
        <button
          v-if="recording()"
          class="route-btn"
          @click="emit('pause')"
        >
          <Pause :size="14" /> 暂停
        </button>
        <button v-else class="route-btn" @click="emit('resume')">
          <Play :size="14" /> 继续
        </button>
        <button class="route-btn primary" @click="emit('stop')">
          <Square :size="13" /> 完成并剪辑
        </button>
        <button
          class="route-btn ghost"
          aria-label="放弃录制"
          @click="emit('discard')"
        >
          <Trash2 :size="14" />
        </button>
      </template>
    </div>
  </div>
</template>
