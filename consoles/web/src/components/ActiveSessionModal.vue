<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store } from '../session'
import { duration } from '../units'
import { deviceTypeName } from '../status'

// Shown on load while a session exists: the usual reason to open the console then is to start a bridge on a
// second device. Reads store.current (polled by App.vue); the elapsed display ticks locally.
const session = computed(() => store.current?.session ?? null)
const now = ref(Date.now())
let timer: number | undefined
onMounted(() => { timer = window.setInterval(() => (now.value = Date.now()), 1000) })
onUnmounted(() => window.clearInterval(timer))

const elapsed = computed(() => {
  const s = session.value
  if (!s) return 0
  return s.status === 'active' ? s.elapsed + (now.value - store.currentAt) / 1000 : s.elapsed
})

// Games are stateful: a running game cannot move to this screen, so the only choices are to join it as a
// bridge (device + remote) or to carry on to the console's main screen (a new launch replaces it).
const silent = computed(() => {
  const s = session.value
  return s && s.gameAge != null && s.gameAge > 10 ? Math.round(s.gameAge) : null
})
function openBridge() {
  if (session.value) window.location.href = session.value.joinUrl
}
function dismiss() {
  store.modalDismissed = true
}
</script>

<template>
  <div v-if="session" class="layer-backdrop">
    <div class="layer page-status" role="dialog" aria-modal="true" data-focus-layer>
      <h2>A Game is Already Running</h2>
      <div>
        <div class="big-title">{{ session.gameName }}</div>
        <div class="muted">{{ session.variantName }} · {{ deviceTypeName(session.deviceType) }}</div>
      </div>
      <div class="actions">
        <span class="pill" :class="session.status">{{ session.status === 'active' ? 'playing' : session.status }}</span>
        <span v-if="session.debug" class="pill debug">debug</span>
        <span class="elapsed">{{ duration(elapsed) }}<span v-if="session.requestedDuration" class="muted"> / {{ duration(session.requestedDuration) }}</span></span>
      </div>
      <p v-if="session.status === 'paused'" class="notice error">Paused: {{ session.pause?.message }}</p>
      <p v-else-if="silent" class="notice error">The game has not responded for {{ silent }} s. Starting a new game replaces it.</p>
      <div class="actions stack">
        <button type="button" class="btn big primary" @click="openBridge">Open Bridge</button>
        <button type="button" class="btn big" data-back @click="dismiss">Open Main Screen</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.big-title { font-weight: 900; font-size: 1.5em; line-height: 1.1; }
.elapsed { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 1.1em; }
</style>
