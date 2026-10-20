<script setup lang="ts">
// Leaderboards (PLAN.md §18.7). The server precomputes every board; this picks one and shows it, with the
// podium picked out, your own row pinned in view, and a link to every player's profile.
import { computed, onMounted, ref, watch } from 'vue'
import { board, boards, groupBoards, playerName, rankBadge } from '../profiles'
import { store, unitSystem } from '../session'
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
    // Open on a board that has somebody on it, so the page is never empty when it needn't be.
    chosen.value = (list.value.find((b) => b.players > 0) ?? list.value[0])?.id ?? null
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

const grouped = computed(() => groupBoards(list.value))
const sys = computed(() => unitSystem())
const value = (v: number): string => u.boardValue(current.value?.unit ?? 'number', v, sys.value)
const mine = computed(() => current.value?.rows.find((r) => r.me) ?? null)
const myRank = computed(() => mine.value?.rank ?? null)
const top = computed(() => current.value?.rows.slice(0, 3) ?? [])
/** How long the bar is, against the leader: a board reads faster with a shape than with numbers alone. */
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
  return b.periodKey.includes('W') ? `week ${b.periodKey}` : b.periodKey
})
</script>

<template>
  <section class="page page-leaderboards">
    <div class="page-head">
      <h1>Leaderboards</h1>
      <span v-if="myRank" class="lead you">You are <b>{{ rankBadge(myRank) }}</b> here</span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <nav v-if="grouped.length" class="picker" aria-label="Leaderboards">
      <div v-for="g in grouped" :key="g.title" class="group">
        <h2>{{ g.title }}</h2>
        <div class="chips">
          <button
            v-for="b in g.boards" :key="b.id" type="button" class="boardchip"
            :class="{ on: chosen === b.id, empty: b.players === 0 }"
            :title="b.subtitle" @click="chosen = b.id"
          >
            {{ b.title }}
            <span v-if="b.subtitle" class="sub">{{ b.subtitle }}</span>
            <span class="n">{{ b.players || '—' }}</span>
          </button>
        </div>
      </div>
    </nav>

    <section v-if="current" class="panel board" :class="{ busy: loadingRows }">
      <header class="boardhead">
        <div>
          <h2>{{ current.title }}</h2>
          <p class="muted small">{{ current.subtitle }} · {{ periodLabel }}<template v-if="current.lowerIsBetter"> · lower is better</template></p>
        </div>
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
  </section>
</template>

<style scoped>
.you b { font-weight: 900; }
.picker .group { margin-bottom: 10px; }
.picker h2 { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin: 0 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.boardchip { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; position: relative;
  padding: 8px 34px 8px 12px; border: 0; border-radius: 12px; background: var(--panel-2); color: inherit;
  font: inherit; font-weight: 800; cursor: pointer; text-align: left;
  transition: transform 0.12s ease, background 0.12s ease; }
.boardchip:hover { transform: translateY(-1px); }
.boardchip.on { background: var(--page); color: #fff; }
.boardchip.empty:not(.on) { opacity: 0.55; }
.boardchip .sub { font-size: 0.74em; font-weight: 600; opacity: 0.75; }
.boardchip .n { position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  font-size: 0.72em; font-weight: 800; opacity: 0.65; }
.board { transition: opacity 0.15s ease; }
.board.busy { opacity: 0.6; }
.boardhead h2 { margin: 0; }
.small { font-size: 0.86em; }
.empty-note { margin: 0; }
.rows { list-style: none; margin: 0; padding: 0; counter-reset: none; display: flex; flex-direction: column; gap: 3px; }
.row { display: grid; grid-template-columns: 40px minmax(120px, 1.3fr) minmax(60px, 2fr) auto;
  gap: 12px; align-items: center; padding: 7px 10px; border-radius: 10px; animation: in 0.25s ease both; }
.row:nth-child(odd) { background: color-mix(in srgb, var(--text) 3%, transparent); }
.row.me { background: color-mix(in srgb, var(--page) 18%, transparent); box-shadow: inset 0 0 0 1px var(--page); }
.row.unranked { opacity: 0.8; }
.rank { font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
.rank.r1, .rank.r2, .rank.r3 { font-size: 1.3em; }
.bar { display: block; height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--text) 9%, transparent); overflow: hidden; }
.fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--page), color-mix(in srgb, #6ee7a8 60%, var(--page)));
  transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
.row.podium .fill { background: linear-gradient(90deg, #ff9d3c, #ffd479); }
.value { font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; }
@keyframes in { from { opacity: 0; transform: translateX(-6px); } }
@media (prefers-reduced-motion: reduce) {
  .row { animation: none; } .fill { transition: none; } .boardchip:hover { transform: none; }
}
@media (max-width: 620px) {
  .row { grid-template-columns: 34px 1fr auto; }
  .bar { display: none; }
}
</style>
