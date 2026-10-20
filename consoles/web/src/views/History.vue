<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, query } from '../api'
import type { SessionSummary, SessionsResponse } from '../types'
import * as u from '../units'
import { hueIndex, initialOf } from '../status'

// A gallery of past sessions: picture, variant name, when, Duration and Energy. Discarded ones are hidden
// unless asked for (the API omits them by default).
const router = useRouter()
const sessions = ref<SessionSummary[]>([])
const nextBefore = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const showDiscarded = ref(false)
const now = ref(Date.now())
let tick: number | undefined
onMounted(() => { tick = window.setInterval(() => (now.value = Date.now()), 30000) })
onUnmounted(() => window.clearInterval(tick))

const PAGE = 24
async function load(more = false) {
  loading.value = true
  error.value = null
  try {
    const q = query({ limit: PAGE, before: more ? nextBefore.value : null, includeDiscarded: showDiscarded.value ? 1 : null })
    const res = await api<SessionsResponse>(`/api/sessions${q}`)
    sessions.value = more ? [...sessions.value, ...res.sessions] : res.sessions
    nextBefore.value = res.nextBefore
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
function toggleDiscarded() {
  showDiscarded.value = !showDiscarded.value
  nextBefore.value = null
  void load()
}
onMounted(() => load())

const live = (s: SessionSummary) => s.status === 'active' || s.status === 'paused' || s.status === 'pending'
const title = (s: SessionSummary) => s.variantName ?? s.variant
const when = computed(() => (s: SessionSummary) => u.ago(s.startedAt ?? s.createdAt, now.value))
const dur = (s: SessionSummary) => u.duration(s.duration ?? (live(s) ? (s.elapsed ?? null) : null))
const open = (s: SessionSummary) => router.push(`/sessions/${s.sessionId}`)

const deleting = ref<string | null>(null)

/**
 * Delete a session from the list. The server takes it back off the leaderboards, out of the totals and off
 * the profile timeline, so the warning says as much — this is not just hiding a row.
 */
async function remove(s: SessionSummary): Promise<void> {
  const what = `${s.gameName ?? s.gameId}, ${when.value(s)}`
  if (!confirm(`Delete this session?\n\n${what}\n\nIt comes off the leaderboards, your totals and your `
    + `profile, and stops counting towards your streak. The log file stays on disk.`)) return
  deleting.value = s.sessionId
  try {
    await api(`/api/sessions/${s.sessionId}`, 'DELETE')
    sessions.value = sessions.value.filter((x) => x.sessionId !== s.sessionId)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    deleting.value = null
  }
}

</script>

<template>
  <section class="page page-history">
    <div class="page-head">
      <h1>History</h1>
      <span class="lead">Your past sessions</span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="!loading && sessions.length === 0" class="empty">No sessions yet. Play a game and it shows up here.</p>
    <div class="cards">
      <div v-for="s in sessions" :key="s.sessionId" class="card" :class="{ dim: s.status === 'discarded' }">
        <button type="button" class="open" @click="open(s)">
        <div class="shot" :class="s.imageUrl ? '' : `tile tile-${hueIndex(s.gameId, 6)}`">
          <img v-if="s.imageUrl" :src="s.imageUrl" :alt="title(s)" loading="lazy" />
          <span v-else class="initial">{{ initialOf(s.gameName ?? s.gameId) }}</span>
          <span v-if="s.status !== 'complete'" class="pill status" :class="s.status">{{ s.status === 'active' ? 'playing' : s.status }}</span>
        </div>
        <div class="body">
          <div class="title">{{ title(s) }}</div>
          <div class="sub">{{ when(s) }}</div>
          <div class="metrics">
            <div class="metric"><div class="k">Duration</div><div class="v">{{ dur(s) }}</div></div>
            <div class="metric"><div class="k">Energy</div><div class="v">{{ u.energy(s.energy).text }}</div></div>
          </div>
        </div>
        </button>
        <!-- People ride while they are setting things up, or messing about, and want that not to count. -->
        <button
          v-if="s.status !== 'active' && s.status !== 'pending'" type="button" class="del"
          :disabled="deleting === s.sessionId" :title="`Delete this ${s.gameName ?? s.gameId} session`"
          @click.stop="remove(s)"
        >
          <span aria-hidden="true">✕</span>
          <span class="sr">Delete this session</span>
        </button>
      </div>
    </div>
    <div class="actions center">
      <button v-if="nextBefore" type="button" class="btn big" :disabled="loading" @click="load(true)">{{ loading ? 'Loading…' : 'Load more' }}</button>
    </div>
    <div class="actions center">
      <button type="button" class="btn sm ghost muted" @click="toggleDiscarded">{{ showDiscarded ? 'Hide discarded' : 'Show discarded' }}</button>
    </div>
  </section>
</template>

<style scoped>
/* the card is a link with a delete button on it, so the card itself is no longer one big button */
.card { position: relative; }
.card > .open { display: contents; background: none; border: 0; padding: 0; font: inherit; color: inherit;
  cursor: pointer; text-align: left; }
.del { position: absolute; top: 6px; right: 6px; z-index: 2; width: 26px; height: 26px; display: grid;
  place-items: center; border: 0; border-radius: 50%; cursor: pointer; font: 700 13px/1 system-ui, sans-serif;
  color: #fff; background: rgba(10, 12, 20, 0.6); opacity: 0; transition: opacity 0.12s ease, background 0.12s ease; }
.card:hover .del, .del:focus-visible { opacity: 1; }
.del:hover { background: var(--bad, #c0392b); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (hover: none) { .del { opacity: 0.85; } }

.card.dim { opacity: 0.7; }
</style>
