<script setup lang="ts">
// Home: exactly one screen per situation (see decideScreen in ui.ts).
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { collapseBridge, disconnectFitness, disconnectHrm, fetchEnded, openWizard, pausePlay, pauseSession, playAgain, resumeSession, sendRemote, startGame, stopHosting, store } from '../bridge'
import DeviceCard from '../components/DeviceCard.vue'
import DPad from '../components/DPad.vue'
import EndButtons from '../components/EndButtons.vue'
import PromptPanel from '../components/PromptPanel.vue'
import SetupWizard from '../components/SetupWizard.vue'
import { currentScreen, deviceWord, endReasonWords, localExerciseDevice, ownerBridge } from '../ui'

const props = defineProps<{ launching: boolean; routeSessionId: string | null; autoOffer: boolean }>()

const screen = computed(() => currentScreen())
const s = computed(() => store.session)
const ended = computed(() => store.endedSession)
const router = useRouter()
/** Done with the summary: become a joining bridge (remote + device setup) and stop re-fetching that session. */
function dismissEnded(): void {
  if (store.hosting) stopHosting()
  store.endedSession = null
  void router.replace('/join')
}
const dev = computed(() => localExerciseDevice())
const canStart = computed(() => !!s.value && ['pending', 'active', 'paused'].includes(s.value.status))
const startLabel = computed(() => (props.launching ? 'Start game' : 'Show game here'))
const consoleUrl = (id: string) => `/consoles/web/#/sessions/${id}`
const remote = computed(() => {
  const b = ownerBridge('fitness')
  const d = b?.devices.find((x) => x.role === 'fitness') ?? null
  return { label: b?.label ?? 'another device', device: d }
})
/** join mode on the phone: the session runs elsewhere; this page is the remote */
const remoteMode = computed(() => !!s.value && !store.hosting && (s.value.status === 'active' || s.value.status === 'paused'))

// A launching bridge opened for a session that is no longer current: show that session's outcome instead of waiting forever.
watch(
  () => [props.routeSessionId, store.everOk, store.session?.sessionId] as const,
  ([id, ok, current]) => {
    if (id && ok && !current && store.endedSession?.sessionId !== id) void fetchEnded(id)
  },
  { immediate: true },
)
</script>

<template>
  <div class="tab" :data-screen="screen">
    <!-- 3: session ended -->
    <div v-if="screen === 'ended' && ended" class="card summary" data-test="ended">
      <h3>Session ended</h3>
      <h2>{{ ended.gameName ?? ended.gameId }}</h2>
      <div class="kv">
        <span>Variant</span><span>{{ ended.variant }}</span>
        <span>Ended</span><span>{{ endReasonWords(ended.endReason, ended.status, store.bridgeId) }}</span>
      </div>
      <div class="actions">
        <button class="primary big block" data-test="play-again" @click="playAgain(ended)">▶ Play again</button>
        <a :href="consoleUrl(ended.sessionId)"><button class="block">Open console</button></a>
        <button class="ghost block" data-test="ended-done" @click="dismissEnded">Done</button>
      </div>
      <p class="muted small" style="margin-top: 12px">Start another game from the console; this page will follow it.</p>
    </div>

    <!-- 4: no session -->
    <template v-else-if="screen === 'idle'">
      <div class="card empty" data-test="idle">
        <h2>Waiting for a game</h2>
        <p>Start one from the console. This page follows it automatically.</p>
      </div>
      <div class="card center" data-test="remote-control">
        <h3>Remote control</h3>
        <p class="muted" style="margin-bottom: 14px">Use this to drive Dandyhorse on your big screen.</p>
        <DPad @press="sendRemote" />
      </div>
      <DeviceCard v-if="dev" :device="dev" show-disconnect @disconnect="disconnectFitness" />
      <DeviceCard v-if="store.hrm" :device="store.hrm" show-disconnect @disconnect="disconnectHrm" />
      <div class="actions">
        <button v-if="!dev" class="primary big block" data-test="setup" @click="openWizard">Set up a device</button>
        <button v-else class="block" @click="openWizard">Set up a different device</button>
      </div>
    </template>

    <!-- 5 (and on request): wizard -->
    <SetupWizard v-else-if="screen === 'wizard'" />

    <!-- 6: another bridge supplies the device -->
    <template v-else-if="screen === 'remote' && s">
      <PromptPanel />
      <div class="card" data-test="remote">
        <h3>{{ deviceWord(s.deviceType, true) }}</h3>
        <h2>Connected through {{ remote.label }}</h2>
        <p class="muted">{{ remote.device ? remote.device.name : 'Its ' + deviceWord(s.deviceType) }} is driving this game. You can play from here.</p>
      </div>
      <DeviceCard v-if="store.hrm" :device="store.hrm" />
      <div class="actions">
        <button v-if="canStart && !store.hosting" class="primary big block" data-test="start" @click="startGame">{{ startLabel }}</button>
        <button v-if="store.hosting" class="primary big block" @click="collapseBridge">Back to game</button>
        <button v-if="pausePlay() === 'pause'" class="big block" @click="pauseSession">⏸ Pause</button>
        <button v-if="pausePlay() === 'play'" class="primary big block" @click="resumeSession">▶ Play</button>
        <EndButtons v-if="s.status !== 'pending'" />
        <button class="ghost block" @click="openWizard">Connect a device here instead</button>
      </div>
    </template>

    <!-- 7: ready / running (with no local machine only for a game that needs none, session.autoPause false) -->
    <template v-else-if="screen === 'ready' && s">
      <PromptPanel />
      <DeviceCard v-if="dev" :device="dev" />
      <div v-else class="card" data-test="no-machine">
        <h3>No machine needed</h3>
        <p v-if="store.hrm">This game works without a machine: effort comes from your heart rate monitor. You can also connect your {{ deviceWord(s.deviceType) }}.</p>
        <p v-else>This game works without a machine. Effort can come from a heart rate monitor, or connect your {{ deviceWord(s.deviceType) }}.</p>
        <div class="actions" style="margin-top: 12px"><button class="block" data-test="connect-device" @click="openWizard">Connect a device</button></div>
      </div>
      <DeviceCard v-if="store.hrm" :device="store.hrm" />
      <div class="actions">
        <!-- remote mode (the game runs elsewhere): Pause/Play leads; showing the game here is a secondary action -->
        <button v-if="canStart && !store.hosting && !remoteMode" class="primary big block" data-test="start" @click="startGame">{{ startLabel }}</button>
        <button v-if="store.hosting" class="primary big block" @click="collapseBridge">Back to game</button>
        <button v-if="pausePlay() === 'pause'" class="big block" :class="{ primary: remoteMode }" data-test="pause" @click="pauseSession">⏸ Pause</button>
        <button v-if="pausePlay() === 'play'" class="primary big block" data-test="play" @click="resumeSession">▶ Play</button>
        <button v-if="canStart && !store.hosting && remoteMode" class="ghost block" data-test="start" @click="startGame">{{ startLabel }}</button>
        <EndButtons v-if="s.status !== 'pending'" />
      </div>
      <p v-if="!remoteMode && !store.hosting && s.status === 'pending'" class="muted small center">The game opens inside this page so Bluetooth stays connected.</p>
    </template>
  </div>
</template>
