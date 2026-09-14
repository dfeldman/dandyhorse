<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import Banners from './components/Banners.vue'
import GameHost from './components/GameHost.vue'
import LoginPanel from './components/LoginPanel.vue'
import MoreMenu from './components/MoreMenu.vue'
import Strip from './components/Strip.vue'
import { emergencyStop, shortId, start, store, type Tab } from './bridge'
import { showEstop, startFreshness } from './ui'

const TOOL_NAMES: Partial<Record<Tab, string>> = { debug: 'Debug Dandyhorse', ftms: 'Exercise device' }
const openTool = computed(() => (store.tab === 'debug' || store.tab === 'ftms' ? store.tab : null))
const inGame = computed(() => store.hosting && !store.expanded)

onMounted(() => {
  start()
  startFreshness()
})

function closeTool(): void {
  store.tab = 'session'
}
</script>

<template>
  <div class="app" :class="{ game: inGame }">
    <div class="full">
      <div class="sticky">
        <header class="topbar">
          <h1 class="wordmark">Dandyhorse</h1>
          <span class="label" :title="'this bridge: ' + store.label">
            <span class="dot" :class="store.needLogin || store.unreachable ? 'bad' : store.everOk ? 'ok' : 'warn'"></span>
            {{ store.label }}
          </span>
          <span class="spacer"></span>
          <button v-if="showEstop()" class="danger estop" data-test="estop" @click="emergencyStop">E-STOP</button>
        </header>
        <div v-if="store.techDetails" class="techline" data-test="techline">
          tab {{ shortId(store.bridgeId) }} · browser {{ shortId(store.browserId) }} · fitness {{ store.roles.fitness ?? '–' }} · hrm {{ store.roles.hrm ?? '–' }} · seq {{ store.lastSeq }}<template v-if="store.session"> · session {{ store.session.sessionId }} · {{ store.session.status }}</template>
        </div>
        <nav v-if="!store.needLogin" class="tabs">
          <button :class="{ active: store.tab === 'session' }" @click="store.tab = 'session'">Home</button>
          <button :class="{ active: store.tab === 'devices' }" @click="store.tab = 'devices'">Devices</button>
          <template v-if="openTool">
            <button class="active" data-test="tooltab">{{ TOOL_NAMES[openTool] }}</button>
            <button class="close" aria-label="Close developer tool" @click="closeTool">×</button>
          </template>
          <span class="spacer"></span>
          <MoreMenu />
        </nav>
      </div>
      <Banners v-if="!inGame" />
      <LoginPanel v-if="store.needLogin" />
      <RouterView v-else />
    </div>
    <Banners v-if="inGame" />
    <GameHost v-if="store.hosting" />
    <Strip v-if="inGame" />
  </div>
</template>
