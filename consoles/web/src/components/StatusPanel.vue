<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store } from '../session'
import { duration } from '../units'
import { deviceTypeName } from '../status'
import BridgeList from './BridgeList.vue'

// Live status: the current session and the bridges. Reads store.current, which App.vue polls every 4 s.
const session = computed(() => store.current?.session ?? null)
const bridges = computed(() => store.current?.bridges ?? [])
const joinUrl = `${window.location.origin}/bridges/web/#/join`

const now = ref(Date.now())
let timer: number | undefined
onMounted(() => { timer = window.setInterval(() => (now.value = Date.now()), 1000) })
onUnmounted(() => window.clearInterval(timer))
const elapsed = computed(() => {
  const s = session.value
  if (!s) return 0
  return s.status === 'active' ? s.elapsed + (now.value - store.currentAt) / 1000 : s.elapsed
})
</script>

<template>
  <div class="panel page-status">
    <h2>Now playing</h2>
    <template v-if="session">
      <div class="card-title-row">
        <div class="title">{{ session.gameName }}</div>
        <div class="sub">{{ session.variantName }} · {{ deviceTypeName(session.deviceType) }}</div>
      </div>
      <div class="actions">
        <span class="pill" :class="session.status">{{ session.status === 'active' ? 'playing' : session.status }}</span>
        <span v-if="session.debug" class="pill debug">debug</span>
        <span class="metric-inline">{{ duration(elapsed) }}<span v-if="session.requestedDuration" class="muted"> / {{ duration(session.requestedDuration) }}</span></span>
      </div>
      <p v-if="session.status === 'paused'" class="notice error">Paused: {{ session.pause?.message }}</p>
      <div class="actions stack">
        <a class="btn primary" :href="session.joinUrl">Open Bridge</a>
        <router-link class="btn ghost" :to="`/sessions/${session.sessionId}`">Session details</router-link>
      </div>
    </template>
    <p v-else class="muted">No game running. Pick one under Games.</p>
  </div>
  <div class="panel page-status">
    <h2>Devices</h2>
    <BridgeList :bridges="bridges" />
    <p class="hint">Your exercise device connects on the screen that runs the game, or on a phone used as a bridge.</p>
  </div>
  <div class="panel page-status">
    <h2>Use a phone as a bridge</h2>
    <p>On the phone, open this address in Chrome, log in, and connect your treadmill or bike trainer there. It also works as a remote for this screen.</p>
    <p class="join-url">{{ joinUrl }}</p>
    <p class="hint">Pairing by QR code and a short code is planned; for now type the address.</p>
  </div>
</template>

<style scoped>
.card-title-row .title { font-weight: 900; font-size: 1.4em; line-height: 1.1; }
.card-title-row .sub { color: var(--muted); font-weight: 600; }
.metric-inline { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 1.1em; }
.join-url { font-family: var(--mono); font-weight: 700; font-size: 1.1em; word-break: break-all; background: var(--panel-2); padding: 12px 16px; border-radius: var(--radius-sm); }
</style>
