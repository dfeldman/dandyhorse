<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { store, pollCurrent } from './session'
import { startRemote } from './remote'
import { handlePress } from './navigation'
import { focusFirst, focusables, watchLayers } from './focus'
import LoginView from './components/LoginView.vue'
import HandleView from './components/HandleView.vue'
import ActiveSessionModal from './components/ActiveSessionModal.vue'
import ConnectionIndicator from './components/ConnectionIndicator.vue'
import StatusLayer from './components/StatusLayer.vue'

// The big screen is driven by the bridge d-pad (/api/remote) or arrow keys: one press stream, see navigation.ts.
const router = useRouter()
let stopRemote: (() => void) | null = null
function ensureRemote(): void {
  if (store.needsLogin || stopRemote) return
  stopRemote = startRemote({ onPress: (p) => handlePress(p, router), onAuthLost: () => { store.needsLogin = true } })
}
watch(() => store.needsLogin, (need) => { if (need && stopRemote) { stopRemote(); stopRemote = null } else ensureRemote() }, { immediate: true })
onMounted(() => ensureRemote())
// Dialog layers scope navigation; when the last one closes the cursor returns to the page content, not the tab bar.
const stopLayers = watchLayers(() => document.querySelector('main') ?? document.body)
// One poller for /api/sessions/current feeds the indicator, the status layer and the active-session modal.
const stopPoll = pollCurrent(4000)
onUnmounted(() => { stopRemote?.(); stopLayers(); stopPoll() })
// After navigation, put the cursor on the first control of the page (only while the remote is in use). Pages
// load their content asynchronously, so for a short while a control that appears earlier in the page takes
// the cursor over the one we placed it on, unless the user has moved it meanwhile.
let settle: MutationObserver | null = null
let settleTimer: number | undefined
function settleFocus(main: Element): void {
  settle?.disconnect(); window.clearTimeout(settleTimer)
  let placed = focusFirst(main)
  settle = new MutationObserver(() => {
    const first = focusables(main)[0]
    const cur = document.activeElement
    if (first && first !== cur && (cur === placed || cur === document.body || cur === null)) placed = focusFirst(main)
  })
  settle.observe(main, { childList: true, subtree: true })
  settleTimer = window.setTimeout(() => { settle?.disconnect(); settle = null }, 3000)
}
router.afterEach(() => { void nextTick(() => { if (document.body.dataset.remote) settleFocus(document.querySelector('main') ?? document.body) }) })

const statusOpen = ref(false)
const TABS = [
  { to: '/', key: 'games', label: 'Games' },
  { to: '/sessions', key: 'history', label: 'History' },
  { to: '/leaderboards', key: 'leaderboards', label: 'Leaderboards' },
  { to: '/achievements', key: 'achievements', label: 'Achievements' },
  { to: '/preferences', key: 'preferences', label: 'Preferences' },
]
function tabActive(key: string, path: string): boolean {
  if (key === 'games') return path === '/'
  if (key === 'history') return path.startsWith('/sessions')
  return path.startsWith(`/${key}`)
}
</script>

<template>
  <LoginView v-if="store.needsLogin" />
  <HandleView v-else-if="store.me?.needsHandle" />
  <div v-else class="app">
    <header class="topbar">
      <div class="brand"><span class="mark"></span>Dandyhorse</div>
      <nav class="tabs" aria-label="Sections">
        <RouterLink v-for="t in TABS" :key="t.key" :to="t.to" class="tab" :class="[`tab-${t.key}`, { 'router-link-active': tabActive(t.key, $route.path) }]">{{ t.label }}</RouterLink>
        <RouterLink v-if="store.me?.isAdmin" to="/admin" class="tab tab-admin" :class="{ 'router-link-active': $route.path.startsWith('/admin') }">Admin</RouterLink>
      </nav>
      <ConnectionIndicator @open="statusOpen = true" />
    </header>
    <main>
      <RouterView />
    </main>
    <StatusLayer v-if="statusOpen" @close="statusOpen = false" />
    <ActiveSessionModal v-if="store.current?.session && !store.modalDismissed" />
  </div>
</template>
