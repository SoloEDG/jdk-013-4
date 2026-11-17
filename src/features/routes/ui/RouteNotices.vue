<script setup lang="ts">
import { Info, TriangleAlert, MapPin } from "lucide-vue-next";
import type { RouteNotice } from "../model/player";

defineProps<{ notices: RouteNotice[] }>();
</script>

<template>
  <div class="route-notices" aria-live="polite">
    <transition-group name="notice">
      <div
        v-for="n in notices"
        :key="n.id"
        class="route-notice"
        :class="n.kind"
      >
        <TriangleAlert v-if="n.kind === 'gap'" :size="15" />
        <MapPin v-else-if="n.kind === 'marker'" :size="15" />
        <Info v-else :size="15" />
        <span>{{ n.text }}</span>
      </div>
    </transition-group>
  </div>
</template>
