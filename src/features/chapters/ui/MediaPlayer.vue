<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { Playback } from "../model/playback";
const props = defineProps<{
  playback: Playback;
  branch: boolean;
  /** 路线引导中由播放器时钟驱动时间，视频元素不再回写 currentTime */
  guided?: boolean;
}>();
const video = ref<HTMLVideoElement>();
function sync() {
  const v = video.value;
  if (!v) return;
  v.muted = props.playback.state.muted;
  v.playbackRate = props.playback.state.rate;
  if (Math.abs(v.currentTime - props.playback.state.time) > 0.4)
    v.currentTime = props.playback.state.time;
  if (props.playback.state.playing && !props.branch)
    v.play().catch(() => {
      props.playback.state.playing = false;
      props.playback.state.error = "请点击播放以继续";
    });
  else v.pause();
}
onMounted(sync);
watch(
  () => [
    props.playback.state.playing,
    props.playback.state.time,
    props.playback.state.muted,
    props.playback.state.rate,
    props.branch,
    props.guided,
  ],
  sync,
);
</script>
<template>
  <video
    ref="video"
    class="film-texture"
    :src="playback.chapter.value.video"
    playsinline
    :muted="playback.state.muted"
    preload="auto"
    @loadedmetadata="
      playback.state.ready = true;
      sync();
    "
    @timeupdate="
      !branch && !guided && playback.state.playing &&
      playback.tick(($event.target as HTMLVideoElement).currentTime)
    "
    @ended="guided ? undefined : playback.finish()"
    @error="playback.state.error = '影像加载失败，请刷新重试'"
  />
  <div v-if="playback.state.error" role="status" class="media-warning">
    {{ playback.state.error }}
  </div>
</template>
