<script setup lang="ts">
// The session's live numbers on the bridge's own screens: the machine's readings when they come from ANOTHER bridge
// (#305: every bridge shows the same watts), and the grade or incline the game is asking for, with what this bridge set
// its machine to (#306, for debugging the trainer's feel). Nothing at all when there is nothing to say.
import { computed } from 'vue'
import { store } from '../bridge'
import { currentReadout, ownerBridge, percentWords } from '../ui'
import { speedUnit } from '../units'

const props = defineProps<{ values?: boolean }>()
const live = computed(() => currentReadout())
const bike = computed(() => (store.session?.deviceType ?? 'bike') === 'bike')
const MPH = 2.236936, KMH = 3.6
const num = (v: number | null, d = 0): string => (v == null ? '–' : v.toFixed(d))
const speed = computed(() => (live.value.speed == null ? '–' : (live.value.speed * (store.unitSystem === 'us' ? MPH : KMH)).toFixed(1)))
const showValues = computed(() => props.values && live.value.source === 'remote')
const from = computed(() => ownerBridge('fitness')?.label ?? 'another bridge')
</script>

<template>
  <div v-if="showValues || live.target" class="card devcard live-card" data-test="live">
    <div v-if="showValues" class="values num">
      <div v-if="bike" class="value"><b data-test="live-power">{{ num(live.power) }}</b><span>watts</span></div>
      <div v-else class="value"><b>{{ speed }}</b><span>{{ speedUnit(store.unitSystem) }}</span></div>
      <div v-if="live.cadence != null" class="value secondary"><b>{{ num(live.cadence) }}</b><span>rpm</span></div>
    </div>
    <div v-if="showValues" class="status muted">from the {{ bike ? 'trainer' : 'treadmill' }} on {{ from }}</div>
    <div v-if="live.target" class="status" data-test="live-grade">
      The game asks for <b>{{ percentWords(live.target.value) }}</b> {{ live.target.kind }}<template v-if="live.applied != null">; this
      {{ bike ? 'trainer' : 'treadmill' }} is set to <b>{{ percentWords(live.applied) }}</b></template>
    </div>
  </div>
</template>
