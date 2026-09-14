<script setup lang="ts">
// Connect an exercise device, step by step. The Bluetooth button calls connectFtms() synchronously
// (Web Bluetooth needs a user gesture); the simulator path goes through the same steps.
import { computed, ref } from 'vue'
import { closeWizard, connectFtms, connectHrm, disconnectFitness, simulator, simulatorHrm, store, toggleSimulator, toggleSimulatorHrm } from '../bridge'
import { deviceOptional, deviceWord, localExerciseDevice } from '../ui'
import DeviceCard from './DeviceCard.vue'

const emit = defineEmits<{ done: [] }>()
const error = ref<string | null>(null)
const step = computed(() => store.wizardStep)
const session = computed(() => store.session)
const wanted = computed(() => session.value?.deviceType ?? null)
const dev = computed(() => localExerciseDevice())
const mismatch = computed(() => !!dev.value && !!wanted.value && dev.value.type !== wanted.value)
const readonly = computed(() => dev.value?.status === 'readonly')
/** simulators: only for debug sessions, or with no session when developer tools are on */
const simAllowed = computed(() => (session.value ? session.value.debug : store.devTools))
const simType = computed(() => wanted.value ?? 'treadmill')
const cancellable = computed(() => store.wizardOpen)
/** the game plays without a machine (session.autoPause false): the user may go on without one */
const optional = computed(() => deviceOptional())
const STEPS = ['connect', 'result', 'hrm'] as const
const stepIndex = computed(() => (step.value === 'connecting' ? 0 : step.value === 'hrmConnecting' ? 2 : STEPS.indexOf(step.value as typeof STEPS[number])))

function connect(): void {
  error.value = null
  store.wizardOpen = true // keep the wizard on screen through result/heart-rate steps once a device is connected
  store.wizardStep = 'connecting'
  // must be the first thing in the click handler: the Bluetooth chooser needs the gesture
  connectFtms().then(() => { store.wizardStep = 'result' }).catch((e) => {
    error.value = (e as Error).message
    store.wizardStep = 'connect'
  })
}
function useSimulator(): void {
  error.value = null
  store.wizardOpen = true
  store.wizardStep = 'connecting'
  // toggle semantics: a simulator of this type that is already running stays (never disconnect it here)
  const p = simulator()?.deviceType === simType.value ? Promise.resolve() : toggleSimulator(simType.value)
  p.then(() => { store.wizardStep = 'result' }).catch((e) => {
    error.value = (e as Error).message
    store.wizardStep = 'connect'
  })
}
async function tryAgain(): Promise<void> {
  await disconnectFitness()
  store.wizardStep = 'connect'
}
function afterResult(): void {
  if (store.hrm) finish()
  else store.wizardStep = 'hrm'
}
function connectHeart(): void {
  error.value = null
  store.wizardStep = 'hrmConnecting'
  connectHrm().then(finish).catch((e) => {
    error.value = (e as Error).message
    store.wizardStep = 'hrm'
  })
}
function simulateHeart(): void {
  store.wizardStep = 'hrmConnecting'
  ;(simulatorHrm() ? Promise.resolve() : toggleSimulatorHrm()).then(finish).catch((e) => {
    error.value = (e as Error).message
    store.wizardStep = 'hrm'
  })
}
function finish(): void {
  closeWizard()
  emit('done')
}
function cancel(): void {
  closeWizard()
}
</script>

<template>
  <div class="card wizard" data-test="wizard" :data-step="step">
    <div class="steps" aria-hidden="true">
      <i v-for="(s, i) in STEPS" :key="s" :class="{ on: i === stepIndex, done: i < stepIndex }"></i>
    </div>

    <!-- (a) connect -->
    <template v-if="step === 'connect'">
      <div class="icon-big">📶</div>
      <h2>Connect your {{ deviceWord(wanted) }}</h2>
      <template v-if="store.bluetoothReason">
        <p>{{ store.bluetoothReason }}</p>
        <p>Open this page in Chrome or Edge on a desktop or Android device to connect over Bluetooth.</p>
      </template>
      <template v-else>
        <p>Turn the machine on, then tap the button. Your browser will show a list of nearby devices; pick yours.</p>
        <div class="actions">
          <button class="primary big block" data-test="wizard-bluetooth" @click="connect">Connect over Bluetooth</button>
        </div>
      </template>
      <p v-if="error" class="small" style="color: var(--bad)">{{ error }}</p>
      <div class="actions">
        <button v-if="simAllowed" class="block" data-test="wizard-sim" @click="useSimulator">Use a simulated {{ deviceWord(simType) }} instead</button>
        <!-- a game that needs no machine: going on without one replaces "Not now" (they would do the same) -->
        <button v-if="optional" class="block" data-test="wizard-no-machine" @click="finish">Continue without a machine</button>
        <button v-else-if="cancellable" class="ghost block" @click="cancel">Not now</button>
      </div>
    </template>

    <!-- (b) connecting -->
    <template v-else-if="step === 'connecting' || step === 'hrmConnecting'">
      <div class="spinner" role="progressbar"></div>
      <h2>Connecting…</h2>
      <p>{{ step === 'hrmConnecting' ? 'Pick your heart rate monitor in the browser’s list.' : 'Pick your machine in the browser’s list, then wait a moment.' }}</p>
    </template>

    <!-- (c) result -->
    <template v-else-if="step === 'result'">
      <template v-if="!dev">
        <h2>Nothing connected</h2>
        <p>The connection did not complete.</p>
        <div class="actions"><button class="primary big block" @click="store.wizardStep = 'connect'">Try again</button></div>
      </template>
      <template v-else-if="mismatch">
        <div class="icon-big">⚠️</div>
        <h2>Wrong kind of device</h2>
        <p>This is a {{ deviceWord(dev.type) }}; this game needs a {{ deviceWord(wanted) }}.</p>
        <div class="actions"><button class="primary big block" @click="tryAgain">Try again</button></div>
      </template>
      <template v-else>
        <div class="icon-big">✅</div>
        <h2>{{ readonly ? 'Connected, read-only' : 'Connected' }}</h2>
        <p v-if="readonly">This machine only reports data; use its own buttons to change speed.</p>
        <DeviceCard :device="dev" compact />
        <div class="actions"><button class="primary big block" data-test="wizard-continue" @click="afterResult">Continue</button></div>
      </template>
    </template>

    <!-- (d) heart rate monitor -->
    <template v-else-if="step === 'hrm'">
      <div class="icon-big">❤️</div>
      <h2>Add a heart rate monitor?</h2>
      <p>Optional. A chest strap or watch that broadcasts over Bluetooth.</p>
      <p v-if="error" class="small" style="color: var(--bad)">{{ error }}</p>
      <div class="actions">
        <button class="primary big block" :disabled="!!store.bluetoothReason" @click="connectHeart">Connect a heart rate monitor</button>
        <button v-if="simAllowed" class="block" data-test="wizard-sim-hrm" @click="simulateHeart">Use a simulated heart rate monitor</button>
        <button class="ghost block" data-test="wizard-skip" @click="finish">Skip</button>
      </div>
    </template>
  </div>
</template>
