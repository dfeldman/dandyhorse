<script setup lang="ts">
// One banner at a time, most urgent first (see pickBanner in ui.ts).
import { computed } from 'vue'
import { claimRole, clearEmergencyStop, expandBridge, resumeAfterUserStop, resumeSession, store } from '../bridge'
import { currentBanner } from '../ui'

const banner = computed(() => currentBanner())

function act(): void {
  const a = banner.value?.action
  if (!a) return
  switch (a.id) {
    case 'clearEstop': clearEmergencyStop(); break
    case 'login': expandBridge(); break
    case 'play': void resumeSession(); break
    case 'claim': void claimRole('fitness'); break
    case 'resumeControl': resumeAfterUserStop(); break
  }
}
</script>

<template>
  <div class="banners">
    <div v-if="banner" class="banner" :class="banner.level" :data-test="banner.kind" role="status">
      <span class="text">{{ banner.text }}</span>
      <button v-if="banner.action" :disabled="banner.action.id === 'claim' && store.claiming" @click="act">{{ banner.action.label }}</button>
    </div>
  </div>
</template>
