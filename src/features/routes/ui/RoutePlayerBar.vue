<script setup lang="ts">
import {
  Play,
  Pause,
  LogOut,
  LogIn,
  X,
  MapPin,
} from "lucide-vue-next";
import { timecode } from "../../../shared/format";
import type { RoutePlayer } from "../model/player";

const props = defineProps<{ player: RoutePlayer }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="player-bar">
    <div class="player-state">
      <span class="player-badge" :class="player.mode.value">
        {{ player.mode.value === "detour" ? "自由探索中" : "路线引导中" }}
      </span>
      <div class="player-time">
        <strong>{{ timecode(player.routeTime.value) }}</strong>
        <small>/ {{ timecode(player.totalDuration.value) }}</small>
      </div>
    </div>

    <input
      class="player-scrub"
      type="range"
      min="0"
      :max="player.totalDuration.value || 0"
      step="0.1"
      :value="player.routeTime.value"
      :disabled="player.mode.value === 'idle'"
      aria-label="路线进度"
      @input="player.seekRoute(Number(($event.target as HTMLInputElement).value))"
    />

    <div class="player-actions">
      <button
        class="route-btn"
        :aria-label="player.playing.value ? '暂停路线' : '播放路线'"
        @click="player.toggle()"
      >
        <Pause v-if="player.playing.value" :size="15" />
        <Play v-else :size="15" />
      </button>
      <button
        v-if="player.mode.value === 'guided'"
        class="route-btn"
        @click="player.detach()"
      >
        <LogOut :size="14" /> 脱离路线
      </button>
      <button
        v-else-if="player.mode.value === 'detour'"
        class="route-btn primary"
        @click="player.rejoin()"
      >
        <LogIn :size="14" /> 回到路线
      </button>
      <button
        class="route-btn ghost"
        aria-label="结束路线播放"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </div>

    <transition name="rejoin">
      <div v-if="player.rejoinPoint.value" class="rejoin-hint">
        <MapPin :size="14" />
        <span>
          接续位置：{{ player.rejoinPoint.value.title }} ·
          {{ player.rejoinPoint.value.chapter }}
          {{ timecode(player.rejoinPoint.value.time) }}
        </span>
      </div>
    </transition>
  </div>
</template>
