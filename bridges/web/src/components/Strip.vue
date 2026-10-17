<script setup lang="ts">
// 56 px bar under the game: ONE key value (speed or watts), heart rate if present, the grade the game asks for, prompt,
// Pause/Play, E-STOP, Expand. The numbers are the session's, wherever its machine is (#305): a big screen whose phone
// has the trainer shows the phone's watts, and says so.
import { computed, ref, watch } from 'vue'
import { dismissEndScreen, emergencyStop, expandBridge, focusGame, pausePlay, pauseSession, resumeSession, store } from '../bridge'
import { currentReadout, ownerBridge, percentWords, showEstop } from '../ui'
import { speedUnit } from '../units'
import PromptPanel from './PromptPanel.vue'

const sheet = ref(false)
const type = computed(() => store.session?.deviceType ?? 'treadmill')
const prompt = computed(() => store.state?.requestedInput ?? null)
const MPH = 2.236936, KMH = 3.6
const live = computed(() => currentReadout())
const keyValue = computed(() => {
  const a = live.value
  if (type.value === 'bike') return { v: a.power == null ? '–' : a.power.toFixed(0), u: 'W' }
  return { v: a.speed == null ? '–' : (a.speed * (store.unitSystem === 'us' ? MPH : KMH)).toFixed(1), u: speedUnit(store.unitSystem) }
})
/** where the machine is, when it is not here: "via Pixel 4a" (#305: a note, never a warning over the game) */
const via = computed(() => (live.value.source === 'remote' ? ownerBridge('fitness')?.label ?? 'another bridge' : null))
/** the grade (bike) or incline (treadmill) the game asks for, and what this bridge set its machine to (#306) */
const target = computed(() => {
  const t = live.value.target
  if (!t) return null
  const applied = live.value.applied
  const title = `${t.kind === 'grade' ? 'Grade' : 'Incline'} the game asks for: ${percentWords(t.value)}`
    + (applied != null ? ` · this bridge set the ${type.value === 'bike' ? 'trainer' : 'treadmill'} to ${percentWords(applied)}` : '')
  return { text: percentWords(t.value), applied: applied != null && Math.abs(applied - t.value) >= 0.05 ? percentWords(applied) : null, title }
})
const hr = computed(() => store.hrm?.actual.heartRate ?? store.state?.merged?.heartRate?.actual ?? null)
const open = computed(() => !!prompt.value && sheet.value)
// the sheet closed (or its prompt went away): a keyboard or gamepad at the big screen goes back to the game
watch(open, (on) => { if (!on) focusGame() }, { flush: 'post' })
/** the session is over and the game is showing its summary (PLAN.md §6.4.1): Done takes the screen back */
const endScreen = computed(() => (!store.session && store.endHold ? store.state?.endScreen ?? null : null))
/** a strip button pressed with the mouse keeps the focus: give the keys back to the game (#302) */
function then(f: () => unknown): void {
  void f()
  focusGame()
}
</script>

<template>
  <div class="strip">
    <div v-if="store.session" class="metric" :title="via ? `from the machine on ${via}` : 'this bridge\'s machine'" data-test="strip-value"><b>{{ keyValue.v }}</b><span>{{ keyValue.u }}</span></div>
    <div v-if="hr != null" class="metric hr"><b>{{ hr }}</b><span>bpm</span></div>
    <div v-if="target && store.session" class="metric grade" :title="target.title" data-test="strip-grade"><b>{{ target.text }}</b><span>{{ type === 'bike' ? 'grade' : 'incline' }}<template v-if="target.applied"> → {{ target.applied }}</template></span></div>
    <span v-if="via" class="via" data-test="strip-via">via {{ via }}</span>
    <span class="spacer"></span>
    <button v-if="prompt" class="prompt-btn" @click="sheet = !sheet" :title="prompt.prompt">{{ prompt.layout === 'menu' ? 'Menu' : prompt.persistent ? 'Controls' : 'Answer' }}</button>
    <span v-if="endScreen" class="via" data-test="strip-ended">Session complete</span>
    <button v-if="endScreen" class="primary" data-test="strip-done" @click="then(dismissEndScreen)" title="Close the summary">✓ Done ({{ Math.ceil(endScreen.seconds) }})</button>
    <button v-if="pausePlay() === 'pause'" data-test="strip-pause" @click="then(pauseSession)" title="Pause the game">⏸ Pause</button>
    <button v-if="pausePlay() === 'play'" class="primary" data-test="strip-play" @click="then(resumeSession)" title="Resume the game">▶ Play</button>
    <button v-if="showEstop()" class="danger" @click="emergencyStop">E-STOP</button>
    <button @click="expandBridge" title="Show the bridge">▲</button>
  </div>
  <template v-if="open">
    <div class="sheet-back" @click="sheet = false"></div>
    <div class="sheet">
      <PromptPanel compact @answered="prompt?.persistent ? null : (sheet = false)" />
      <div class="row" style="justify-content: flex-end; margin-top: 8px"><button class="small" @click="sheet = false">Close</button></div>
    </div>
  </template>
</template>
