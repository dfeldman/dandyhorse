<script setup lang="ts">
// You against this player (PLAN.md §18.6).
//
// Without this a profile is a page of somebody else's numbers. The question anybody actually has when
// they open another rider on a competitive platform is "how do I compare?", and until now the page did
// not answer it. The server works it out — see social/versus.py, which explains why this is a list of
// where each of you leads rather than a single score.
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { unitSystem } from '../session'
import * as u from '../units'
import type { Versus } from '../types'

const props = defineProps<{ username: string; name: string }>()
const v = ref<Versus | null>(null)
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  try {
    v.value = await api<Versus>(`/api/profiles/${encodeURIComponent(props.username)}/versus`)
  } catch {
    v.value = null    // a comparison is a bonus; a profile without one is still a profile
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.username, load)

const sys = computed(() => unitSystem())
const show = computed(() => v.value && !v.value.self
  && (v.value.measures.length || v.value.boards.length || v.value.games.length))

/** "3 ahead, 10 behind" — the shape of it before any of the detail. */
const headline = computed(() => {
  const x = v.value
  if (!x) return ''
  if (x.ahead > x.behind) return `You lead on ${x.ahead} of ${x.ahead + x.behind}`
  if (x.behind > x.ahead) return `${props.name} leads on ${x.behind} of ${x.ahead + x.behind}`
  return `Level: ${x.ahead} each`
})

const measure = (m: Versus['measures'][number], value: number): string =>
  m.unit === 'W' ? `${value} W`
    : m.unit === 'weeks' ? `${value} ${value === 1 ? 'week' : 'weeks'}`
      : `${value}`

const km = (m: number): string => u.distance(m, sys.value, 1).text
</script>

<template>
  <section v-if="!loading && show" class="panel versus">
    <div class="vhead">
      <h2>You against {{ name }}</h2>
      <span class="head-line" :class="v!.ahead >= v!.behind ? 'good' : 'chase'">{{ headline }}</span>
    </div>

    <ul v-if="v!.measures.length" class="rows">
      <li v-for="m in v!.measures" :key="m.label" class="row" :class="m.leader">
        <span class="label">{{ m.label }}</span>
        <span class="mine">{{ measure(m, m.mine) }}</span>
        <span class="vs" aria-hidden="true">v</span>
        <span class="theirs">{{ measure(m, m.theirs) }}</span>
      </li>
    </ul>

    <template v-if="v!.games.length">
      <h3>Games you have both ridden</h3>
      <ul class="rows">
        <li v-for="g in v!.games" :key="g.gameId" class="row" :class="g.leader">
          <span class="label">{{ g.gameName }}</span>
          <span class="mine">{{ km(g.mine.distance) }}</span>
          <span class="vs" aria-hidden="true">v</span>
          <span class="theirs">{{ km(g.theirs.distance) }}</span>
        </li>
      </ul>
    </template>

    <template v-if="v!.boards.length">
      <h3>Boards you are both on</h3>
      <ul class="rows">
        <li v-for="b in v!.boards" :key="b.board" class="row" :class="b.leader">
          <span class="label">{{ b.title }}</span>
          <span class="mine">{{ b.myRank }}{{ b.myRank === 1 ? 'st' : b.myRank === 2 ? 'nd' : b.myRank === 3 ? 'rd' : 'th' }}</span>
          <span class="vs" aria-hidden="true">v</span>
          <span class="theirs">{{ b.theirRank }}{{ b.theirRank === 1 ? 'st' : b.theirRank === 2 ? 'nd' : b.theirRank === 3 ? 'rd' : 'th' }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.vhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
.vhead h2 { margin: 0; }
.head-line { font-weight: 800; padding: 2px 11px; border-radius: 999px; font-size: 0.88em; }
.head-line.good { background: color-mix(in srgb, #6ee7a8 45%, transparent); }
.head-line.chase { background: color-mix(in srgb, #ffb648 45%, transparent); }
h3 { margin: 14px 0 6px; font-size: 0.94em; opacity: 0.75; }

.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.row { display: grid; grid-template-columns: 1fr auto 18px auto; gap: 10px; align-items: baseline;
  padding: 7px 11px; border-radius: 10px; }
.row:nth-child(odd) { background: color-mix(in srgb, var(--text) 3%, transparent); }
.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mine, .theirs { font-weight: 900; font-variant-numeric: tabular-nums; }
.vs { text-align: center; opacity: 0.45; font-size: 0.82em; }
/* The one who is ahead is the one in colour; the other is simply there. */
.row.me .mine { color: #12a874; }
.row.them .theirs { color: #e5157f; }
.row.me .theirs, .row.them .mine { opacity: 0.6; }
</style>
