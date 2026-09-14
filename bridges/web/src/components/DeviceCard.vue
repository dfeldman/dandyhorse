<script setup lang="ts">
// One connected device: name, ONE big live value (plus incline for a treadmill), a status line.
import { computed } from 'vue'
import { store } from '../bridge'
import type { FitnessDevice } from '../devices/FitnessDevice'
import { controlLine, controlsWords, deviceWord, fitnessFresh, hrmFresh, ownerBridge, statusWord } from '../ui'
import { speedUnit } from '../units'
import { speedAllowed } from '../pipeline'

const props = defineProps<{ device: FitnessDevice; compact?: boolean; showDisconnect?: boolean }>()
const emit = defineEmits<{ disconnect: [] }>()

const isHrm = computed(() => props.device.role === 'hrm')
const kind = computed(() => props.device.type)
const fresh = computed(() => (isHrm.value ? hrmFresh() : fitnessFresh()))
const role = computed(() => (isHrm.value ? store.roles.hrm : store.roles.fitness))
const control = computed(() => controlLine(role.value, ownerBridge(isHrm.value ? 'hrm' : 'fitness')?.label ?? null))
const gameWords = computed(() => (isHrm.value || role.value !== 'owner' ? null : controlsWords(store.session?.controls, kind.value, speedAllowed(props.device.protocol, store.devicePreferences[props.device.address]))))
const dotClass = computed(() => {
  const s = props.device.status
  if (s === 'connected' || s === 'readonly') return 'ok'
  if (s === 'simulated') return 'sim'
  if (s === 'connecting') return 'warn'
  return 'bad'
})
const MPH = 2.236936, KMH = 3.6
function speed(v: number | null): string {
  if (v == null) return '–'
  return (v * (store.unitSystem === 'us' ? MPH : KMH)).toFixed(1)
}
function num(v: number | null, digits = 0): string { return v == null ? '–' : v.toFixed(digits) }
const a = computed(() => props.device.actual)
/** devicelib's identification (registry entry, quirks), to check a machine before switching speed control on. */
const libLine = computed(() => {
  const f = props.device.features as { registryEntry?: string | null; quirks?: string[] }
  return [f.registryEntry, ...(f.quirks ?? [])].filter(Boolean).join(' · ')
})
const hasValue = computed(() => (isHrm.value ? a.value.heartRate != null : kind.value === 'bike' ? a.value.power != null : a.value.speed != null))
</script>

<template>
  <div class="card devcard" :class="{ compact }">
    <div class="name">
      <span>{{ device.name }}</span>
      <span class="muted small">· {{ deviceWord(kind) }}</span>
      <span class="dot" :class="[dotClass, { live: fresh && hasValue }]" :title="fresh ? 'updating' : ''"></span>
    </div>
    <div class="values num">
      <template v-if="isHrm">
        <div class="value"><b>{{ num(a.heartRate) }}</b><span>bpm</span></div>
      </template>
      <template v-else-if="kind === 'bike'">
        <div class="value"><b>{{ num(a.power) }}</b><span>watts</span></div>
        <div v-if="a.cadence != null" class="value secondary"><b>{{ num(a.cadence) }}</b><span>rpm</span></div>
      </template>
      <template v-else>
        <div class="value"><b>{{ speed(a.speed) }}</b><span>{{ speedUnit(store.unitSystem) }}</span></div>
        <div class="value"><b>{{ num(a.incline, 1) }}</b><span>% incline</span></div>
        <div v-if="a.power != null" class="value secondary"><b>{{ num(a.power) }}</b><span>watts</span></div>
      </template>
    </div>
    <div class="status" :class="{ warn: device.status === 'readonly' || role === 'standby' }">
      {{ statusWord(device.status) }}<template v-if="control"> · {{ control }}</template>
      <span v-if="device.error" class="muted"> · {{ device.error }}</span>
    </div>
    <div v-if="gameWords" class="status">{{ gameWords }}</div>
    <div v-if="store.techDetails" class="tech">{{ device.address || 'no address' }} · {{ device.protocol }} · {{ role ?? 'unconfirmed' }}<template v-if="libLine"> · {{ libLine }}</template></div>
    <div v-if="showDisconnect" class="row"><button class="small" @click="emit('disconnect')">Disconnect</button></div>
  </div>
</template>
