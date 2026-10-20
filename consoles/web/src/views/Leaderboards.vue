<script setup lang="ts">
// Leaderboards (PLAN.md §18.7).
//
// There are nineteen boards, which is a lot to put in front of somebody. So the page leads with where *you*
// stand: the list down the side shows your own rank on every board at a glance, and the boards you are on
// come first. Picking one opens it beside the list rather than somewhere below it.
import { computed, onMounted, ref, watch } from 'vue'
import { board, boards, ordinal, playerName, rankBadge } from '../profiles'
import { unitSystem } from '../session'
import * as u from '../units'
import CountUp from '../components/CountUp.vue'
import PlayerChip from '../components/PlayerChip.vue'
import type { Board, BoardResponse } from '../types'

const list = ref<Board[]>([])
const chosen = ref<string | null>(null)
const current = ref<BoardResponse | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)
const loadingRows = ref(false)

onMounted(async () => {
  try {
    list.value = await boards()
    // Open on a board you are actually on; failing that, one with somebody on it.
    chosen.value = (list.value.find((b) => b.me?.rank) ?? list.value.find((b) => b.players > 0)
      ?? list.value[0])?.id ?? null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

watch(chosen, async (id) => {
  if (!id) return
  loadingRows.value = true
  try {
    current.value = await board(id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loadingRows.value = false
  }
})

const PERIOD: Record<Board['period'], string> = { week: 'This week', month: 'This month', all: 'All time' }
/** 🚲 / 🏃 for the boards that are about one machine, so two boards with the same title are told apart. */
const DEVICE: Record<string, string> = { bike: '🚲', treadmill: '🏃' }

/** Yours first, then the busiest: a board nobody is on is not what anybody came to look at. */
const ordered = computed(() => {
  const score = (b: Board): number => (b.me?.rank ? 2 : b.players > 0 ? 1 : 0)
  return [...list.value].sort((a, b) => score(b) - score(a) || b.players - a.players)
})

/** The subtitle, plus when it covers — unless the subtitle already says so ("All time · All time"). */
function subtitleOf(b: Board): string {
  const period = PERIOD[b.period]
  const sub = b.subtitle.trim()
  if (!sub) return period
  return sub.toLowerCase().includes(period.toLowerCase().replace('this ', '')) ? sub : `${sub} · ${period}`
}

const onBoards = computed(() => list.value.filter((b) => b.me?.rank).length)
const best = computed(() => {
  const mine = list.value.filter((b) => b.me?.rank)
  return mine.length ? mine.reduce((a, b) => ((a.me!.rank ?? 99) <= (b.me!.rank ?? 99) ? a : b)) : null
})

const sys = computed(() => unitSystem())
const value = (v: number): string => u.boardValue(current.value?.unit ?? 'number', v, sys.value)
const mine = computed(() => current.value?.rows.find((r) => r.me) ?? null)

/** The bar's length against the leader: a board reads faster with a shape than with numbers alone. */
function bar(v: number): string {
  const rows = current.value?.rows ?? []
  const best = current.value?.lowerIsBetter
    ? Math.min(...rows.map((r) => r.value))
    : Math.max(...rows.map((r) => r.value))
  if (!Number.isFinite(best) || best === 0) return '0%'
  const f = current.value?.lowerIsBetter ? best / v : v / best
  return `${Math.max(3, Math.min(100, f * 100))}%`
}

const periodLabel = computed(() => {
  const b = current.value
  if (!b) return ''
  if (b.period === 'all') return 'all time'
  return b.periodKey.includes('W') ? `week ${b.periodKey.split('-W')[1]}` : b.periodKey
})
</script>

<template>
  <section class="page page-leaderboards">
    <div class="page-head">
      <h1>Leaderboards</h1>
      <span v-if="best" class="lead">
        Best of yours: <b>{{ rankBadge(best.me!.rank) }}</b> in {{ best.title }}
      </span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <p v-else-if="onBoards === 0" class="muted hint">
      You are not on any of these yet. Finish a session that counts — not a debug one — and you will be.
    </p>
    <p v-else class="muted hint">You are on {{ onBoards }} of {{ list.length }} boards.</p>

    <div v-if="!loading" class="split">
      <nav class="picker" aria-label="Leaderboards">
        <button
          v-for="b in ordered" :key="b.id" type="button" class="board-item"
          :class="{ on: chosen === b.id, empty: b.players === 0 }"
          :aria-current="chosen === b.id ? 'true' : undefined"
          @click="chosen = b.id"
        >
          <span class="bi-main">
            <span class="bi-title">
              <span v-if="b.device" class="bi-dev" aria-hidden="true">{{ DEVICE[b.device] }}</span>{{ b.title }}
            </span>
            <span class="bi-sub">{{ subtitleOf(b) }}</span>
          </span>
          <span v-if="b.me?.rank" class="bi-rank" :class="{ podium: b.me.rank <= 3 }">{{ rankBadge(b.me.rank) }}</span>
          <span v-else-if="b.players" class="bi-n">{{ b.players }}</span>
          <span v-else class="bi-n empty">—</span>
        </button>
      </nav>

      <section v-if="current" class="panel board" :class="{ busy: loadingRows }">
        <header class="boardhead">
          <h2>
            <span v-if="current.device" aria-hidden="true">{{ DEVICE[current.device] }} </span>{{ current.title }}
          </h2>
          <p class="muted small">
            {{ current.subtitle }}<template v-if="current.subtitle"> · </template>{{ periodLabel }}<template
              v-if="current.lowerIsBetter"> · lower is better</template>
          </p>
          <p v-if="mine?.rank" class="standing">
            You are <b>{{ ordinal(mine.rank) }}</b> of {{ current.rows.filter((r) => r.rank).length }}.
          </p>
        </header>

        <p v-if="current.rows.length === 0" class="muted empty-note">
          Nobody is on this one yet. Finish a session that counts and you will be first.
        </p>

        <ol v-else class="rows">
          <li
            v-for="r in current.rows" :key="r.uid" class="row"
            :class="{ me: r.me, podium: r.rank !== null && r.rank <= 3, unranked: r.rank === null }"
          >
            <span class="rank" :class="`r${r.rank ?? 0}`">{{ rankBadge(r.rank) }}</span>
            <PlayerChip :player="r" size="sm" class="chipcol" />
            <span class="bar" aria-hidden="true"><span class="fill" :style="{ width: bar(r.value) }"></span></span>
            <span class="value"><CountUp :value="r.value" :format="value" /></span>
          </li>
        </ol>

        <p v-if="mine && mine.rank === null" class="muted small">
          Your profile is private, so you are shown here only to you. Make it public in Preferences to be ranked.
        </p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.hint { margin: 0; }
.lead b { font-weight: 900; }
.split { display: grid; grid-template-columns: minmax(230px, 300px) 1fr; gap: 14px; align-items: start; }

.picker { display: flex; flex-direction: column; gap: 3px; max-height: 70vh; overflow-y: auto;
  padding: 6px; border-radius: 14px; background: var(--panel); box-shadow: var(--shadow); }
.board-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0;
  border-radius: 10px; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left;
  transition: background 0.12s ease; }
.board-item:hover { background: var(--panel-2); }
.board-item.on { background: var(--page); color: var(--on-page); }
.board-item.empty:not(.on) { opacity: 0.5; }
.bi-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.bi-title { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bi-dev { margin-right: 5px; }
.bi-sub { font-size: 0.76em; opacity: 0.72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bi-rank { font-weight: 900; font-variant-numeric: tabular-nums; flex: none; }
.bi-rank.podium { font-size: 1.2em; }
.bi-n { font-size: 0.78em; font-weight: 700; opacity: 0.6; flex: none; font-variant-numeric: tabular-nums; }

.board { transition: opacity 0.15s ease; }
.board.busy { opacity: 0.55; }
.boardhead h2 { margin: 0; }
.standing { margin: 0; font-weight: 700; }
.standing b { font-size: 1.15em; }
.small { font-size: 0.86em; }
.empty-note { margin: 0; }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.row { display: grid; grid-template-columns: 40px minmax(120px, 1.3fr) minmax(60px, 2fr) auto;
  gap: 12px; align-items: center; padding: 7px 10px; border-radius: 10px; animation: in 0.25s ease both; }
.row:nth-child(odd) { background: color-mix(in srgb, var(--text) 3%, transparent); }
.row.me { background: color-mix(in srgb, var(--page) 18%, transparent); box-shadow: inset 0 0 0 1px var(--page); }
.row.unranked { opacity: 0.8; }
.rank { font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
.rank.r1, .rank.r2, .rank.r3 { font-size: 1.3em; }
.bar { display: block; height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--text) 9%, transparent); overflow: hidden; }
.fill { display: block; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--page), color-mix(in srgb, #6ee7a8 60%, var(--page)));
  transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
.row.podium .fill { background: linear-gradient(90deg, #ff9d3c, #ffd479); }
.value { font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; }

@keyframes in { from { opacity: 0; transform: translateX(-6px); } }
@media (prefers-reduced-motion: reduce) {
  .row { animation: none; } .fill { transition: none; }
}
@media (max-width: 860px) {
  .split { grid-template-columns: 1fr; }
  .picker { max-height: 240px; }
}
@media (max-width: 620px) {
  .row { grid-template-columns: 34px 1fr auto; }
  .bar { display: none; }
}
</style>
