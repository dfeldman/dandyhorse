<script setup lang="ts">
// 56 px bar under the game: ONE key value (speed or watts), heart rate if present, prompt, Pause/Play, E-STOP, Expand.
import { computed, ref, watch } from 'vue'
import { emergencyStop, expandBridge, focusGame, pausePlay, pauseSession, resumeSession, store } from '../bridge'
import { localExerciseDevice, showEstop } from '../ui'
import { speedUnit } from '../units'
import PromptPanel from './PromptPanel.vue'

const sheet = ref(false)
const dev = computed(() => localExerciseDevice())
const type = computed(() => dev.value?.type ?? store.session?.deviceType ?? 'treadmill')
const prompt = computed(() => store.state?.requestedInput ?? null)
const MPH = 2.236936, KMH = 3.6
const keyValue = computed(() => {
  const a = dev.value?.actual
  if (!a) return { v: '–', u: '' }
  if (type.value === 'bike') return { v: a.power == null ? '–' : a.power.toFixed(0), u: 'W' }
  return { v: a.speed == null ? '–' : (a.speed * (store.unitSystem === 'us' ? MPH : KMH)).toFixed(1), u: speedUnit(store.unitSystem) }
})
const hr = computed(() => store.hrm?.actual.heartRate ?? null)
const open = computed(() => !!prompt.value && sheet.value)
// the sheet closed (or its prompt went away): a keyboard or gamepad at the big screen goes back to the game
watch(open, (on) => { if (!on) focusGame() }, { flush: 'post' })
</script>

<template>
  <div class="strip">
    <div class="metric" :title="dev ? dev.name : 'no exercise device on this bridge'"><b>{{ keyValue.v }}</b><span>{{ keyValue.u }}</span></div>
    <div v-if="hr != null" class="metric hr"><b>{{ hr }}</b><span>bpm</span></div>
    <span class="spacer"></span>
    <button v-if="prompt" class="prompt-btn" @click="sheet = !sheet" :title="prompt.prompt">{{ prompt.layout === 'menu' ? 'Menu' : prompt.persistent ? 'Controls' : 'Answer' }}</button>
    <button v-if="pausePlay() === 'pause'" @click="pauseSession" title="Pause the game">⏸</button>
    <button v-if="pausePlay() === 'play'" class="primary" @click="resumeSession" title="Resume the game">▶ Play</button>
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
