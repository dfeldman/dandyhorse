<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, ApiError } from '../api'
import { loadCurrent, timeZone, unitSystem } from '../session'
import type { SessionDetail, TimelineResponse, TimelineRow } from '../types'
import * as u from '../units'
import * as charts from '../charts'
import { deviceTypeName, hueIndex, initialOf } from '../status'
import LineChart from '../components/LineChart.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()

const session = ref<SessionDetail | null>(null)
const timeline = ref<TimelineRow[]>([])
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busy = ref(false)

const sys = computed(() => unitSystem())
const tz = computed(() => timeZone())
const live = computed(() => ['pending', 'active', 'paused'].includes(session.value?.status ?? ''))

async function load() {
  try {
    session.value = await api<SessionDetail>(`/api/sessions/${props.id}`)
    timeline.value = (await api<TimelineResponse>(`/api/sessions/${props.id}/timeline`)).timeline
    error.value = null
  } catch (e) {
    error.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  }
}

let poll: number | undefined
onMounted(async () => {
  await load()
  poll = window.setInterval(() => {
    if (live.value) load()
  }, 4000)
})
onUnmounted(() => window.clearInterval(poll))

function back() {
  if (window.history.length > 1) router.back()
  else router.push('/sessions')
}

// --- charts -----------------------------------------------------------------
const MAP = { w: 400, h: 300, pad: 12 }
const PROFILE = { w: 800, h: 180, pad: 36 }
const GRAPH = { w: 800, h: 160, pad: 36 }

const minimap = computed(() => charts.minimap(timeline.value, MAP))
const profile = computed(() => charts.profile(timeline.value, PROFILE))
const graphs = computed(() =>
  charts
    .graphSpecs(timeline.value)
    .map((spec) => {
      const convert = spec.key === 'speed' ? (v: number) => u.speed(v, sys.value, 3).value ?? v : (v: number) => v
      const unit = spec.key === 'speed' ? u.unitLabel('speed', sys.value) : spec.key === 'power' ? 'W' : spec.key === 'heartRate' ? 'bpm' : '%'
      return { spec, unit, series: charts.graph(timeline.value, spec, GRAPH, convert) }
    })
    .filter((g) => g.series !== null),
)
const distLabel = (v: number) => u.distance(v, sys.value, 1).text
const elevLabel = (v: number) => u.length(v, sys.value).text
const timeLabel = (v: number) => u.duration(v)

// --- actions ----------------------------------------------------------------
async function del() {
  if (!session.value || !confirm('Delete this session? It will be hidden everywhere (the log file is kept on disk).')) return
  busy.value = true
  actionError.value = null
  try {
    await api(`/api/sessions/${props.id}`, 'DELETE')
    router.push('/sessions')
  } catch (e) {
    actionError.value = e instanceof ApiError && e.status === 409 ? 'This session is still running; end it first.' : (e as Error).message
  } finally {
    busy.value = false
  }
}

async function end() {
  if (!session.value || !confirm('End this session as discarded?')) return
  busy.value = true
  actionError.value = null
  try {
    await api(`/api/sessions/${props.id}/end`, 'POST', { status: 'discarded' })
    await load()
    await loadCurrent().catch(() => null)
  } catch (e) {
    actionError.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="page page-history">
    <div class="actions">
      <button type="button" class="btn back" @click="back">Back</button>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <template v-if="session">
      <div class="session-hero">
        <div class="hero-shot" :class="session.imageUrl ? '' : `tile tile-${hueIndex(session.gameId, 6)}`">
          <img v-if="session.imageUrl" :src="session.imageUrl" :alt="session.variantName" />
          <span v-else class="initial">{{ initialOf(session.gameName) }}</span>
        </div>
        <div class="hero-text">
          <h1>{{ session.variantName }}</h1>
          <div class="muted sub">{{ session.gameName }} · {{ deviceTypeName(session.deviceType) }} · {{ u.dateTime(session.startedAt ?? session.createdAt, tz) }}</div>
          <div class="actions">
            <span class="pill" :class="session.status">{{ session.status === 'active' ? 'playing' : session.status }}</span>
            <span v-if="session.debug" class="pill debug">debug</span>
          </div>
          <p v-if="session.status === 'paused'" class="notice error">Paused: {{ session.pause?.message }}</p>
        </div>
      </div>

      <div class="stats">
        <div class="stat hero"><div class="k">Duration</div><div class="v">{{ u.duration(session.duration ?? (live ? (session.elapsed ?? null) : null)) }}</div></div>
        <div class="stat hero"><div class="k">Energy</div><div class="v">{{ u.energy(session.energy).text }}</div></div>
        <div class="stat"><div class="k">Distance</div><div class="v">{{ u.distance(session.distance, sys).text }}</div></div>
        <div class="stat"><div class="k">Work</div><div class="v">{{ session.work === null ? '—' : Math.round(session.work / 1000) + ' kJ' }}</div></div>
        <div class="stat"><div class="k">Avg / max power</div><div class="v">{{ u.power(session.avgPower).text }} / {{ u.power(session.maxPower).text }}</div></div>
        <div class="stat"><div class="k">Avg / max speed</div><div class="v">{{ u.speed(session.avgSpeed, sys).text }} / {{ u.speed(session.maxSpeed, sys).text }}</div></div>
        <div class="stat"><div class="k">Avg / max HR</div><div class="v">{{ u.heartRate(session.avgHr).text }} / {{ u.heartRate(session.maxHr).text }}</div></div>
        <div class="stat"><div class="k">Avg cadence</div><div class="v">{{ session.avgCadence === null ? '—' : Math.round(session.avgCadence) + ' rpm' }}</div></div>
        <div class="stat"><div class="k">Elevation gain</div><div class="v">{{ u.length(session.elevationGain, sys).text }}</div></div>
        <div class="stat"><div class="k">Paused</div><div class="v">{{ session.pausedSeconds ? u.duration(session.pausedSeconds) : '—' }}</div></div>
        <div class="stat"><div class="k">Score</div><div class="v">{{ session.score ?? '—' }}</div></div>
        <div class="stat"><div class="k">Energy source</div><div class="v">{{ session.energySource ?? '—' }}</div></div>
      </div>

      <div v-if="timeline.length === 0" class="empty">No timeline data{{ live ? ' yet' : '' }}.</div>
      <template v-else>
        <div class="two">
          <div class="panel" v-if="minimap">
            <h2>Map</h2>
            <svg class="chart" :viewBox="`0 0 ${MAP.w} ${MAP.h}`" aria-label="Minimap">
              <path class="series" :d="minimap.path" />
              <circle v-if="minimap.start" class="start" :cx="minimap.start.x" :cy="minimap.start.y" r="6" />
              <circle v-if="minimap.end" class="end" :cx="minimap.end.x" :cy="minimap.end.y" r="5" />
            </svg>
            <p class="hint">{{ u.length(minimap.xExtent.max - minimap.xExtent.min, sys).text }} × {{ u.length(minimap.zExtent.max - minimap.zExtent.min, sys).text }}; green = start, red = end.</p>
          </div>
          <div class="panel" v-if="profile">
            <LineChart title="Profile (elevation vs distance)" :series="profile" :w="PROFILE.w" :h="PROFILE.h" :pad="PROFILE.pad" :x-label="distLabel" :y-label="elevLabel" fill />
          </div>
        </div>
        <div class="panel" v-for="g in graphs" :key="g.spec.key">
          <LineChart :title="`${g.spec.label} (${g.unit})`" :series="g.series!" :w="GRAPH.w" :h="GRAPH.h" :pad="GRAPH.pad" :x-label="timeLabel" />
        </div>
      </template>

      <div class="two">
        <div class="panel">
          <h2>Details</h2>
          <dl class="kv">
            <dt>Session</dt><dd class="mono">{{ session.sessionId }}</dd>
            <dt>Game</dt><dd>{{ session.gameId }} v{{ session.gameVersion ?? '?' }}</dd>
            <dt>Variant</dt><dd>{{ session.variant }}</dd>
            <dt>Route</dt><dd>{{ session.route ?? '—' }}</dd>
            <dt>Seed</dt><dd class="mono">{{ session.seed ?? '—' }}</dd>
            <dt>End reason</dt><dd>{{ session.endReason ?? '—' }}</dd>
            <dt>Requested</dt><dd>{{ u.duration(session.requestedDuration) }}</dd>
            <dt>Created</dt><dd>{{ u.dateTime(session.createdAt, tz) }}</dd>
            <dt>Started</dt><dd>{{ u.dateTime(session.startedAt, tz) }}</dd>
            <dt>Ended</dt><dd>{{ u.dateTime(session.endedAt, tz) }}</dd>
            <dt>Samples</dt><dd>{{ session.sampleCount ?? '—' }}</dd>
            <dt>Options</dt><dd class="mono small">{{ JSON.stringify(session.options) }}</dd>
          </dl>
        </div>
        <div class="panel">
          <h2>Body data</h2>
          <dl class="kv">
            <dt>Height</dt><dd>{{ u.height(session.bodyData.height ?? null, sys).text }}</dd>
            <dt>Weight</dt><dd>{{ u.mass(session.bodyData.weight ?? null, sys).text }}</dd>
            <dt>Sex</dt><dd>{{ session.bodyData.sex ?? '—' }}</dd>
            <dt>Age</dt><dd>{{ session.bodyData.age ?? '—' }}</dd>
          </dl>
          <h2>Achievements earned</h2>
          <p v-if="session.achievements.length === 0" class="muted">None in this session.</p>
          <div v-else class="actions"><span v-for="a in session.achievements" :key="a" class="pill">{{ a }}</span></div>
        </div>
      </div>

      <div class="panel">
        <h2>Actions</h2>
        <div class="actions">
          <button v-if="live" type="button" class="btn danger" :disabled="busy" @click="end">End session</button>
          <a class="btn" :href="`/api/sessions/${session.sessionId}/log`" download>Download log</a>
          <button type="button" class="btn danger" :disabled="busy || live" :title="live ? 'End the session first' : ''" @click="del">Delete</button>
        </div>
        <p v-if="actionError" class="error small">{{ actionError }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.session-hero { display: grid; grid-template-columns: minmax(200px, 360px) 1fr; gap: var(--gap); align-items: center; }
.hero-shot { aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; background: var(--panel-2); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow); }
.hero-shot.tile { background: var(--tile); }
.hero-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-shot .initial { font-size: 5em; font-weight: 900; color: var(--on-tile); }
.hero-text { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.hero-text .sub { font-weight: 600; }
@media (max-width: 700px) { .session-hero { grid-template-columns: 1fr; } }
</style>
