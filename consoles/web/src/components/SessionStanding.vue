<script setup lang="ts">
// Where this session stands against recent sessions by players at a similar level (PLAN.md §18.3): the
// small, personal league that makes a finished ride mean something. Quiet when there is nobody to compare
// with — the first rider on a game should not be told they came first out of one.
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { flagOrCode } from '../flags'
import { ordinal, playerName, rankBadge } from '../profiles'
import { unitSystem } from '../session'
import * as u from '../units'
import type { Standing } from '../types'

const props = defineProps<{ sessionId: string; gameName: string }>()

const standing = ref<Standing | null>(null)
const sys = computed(() => unitSystem())

async function load(): Promise<void> {
  standing.value = null
  try {
    standing.value = await api<Standing>(`/api/sessions/${props.sessionId}/standing`)
  } catch {
    standing.value = null // a session page is not the place to report that a league could not be built
  }
}
onMounted(load)
watch(() => props.sessionId, load)

/** Worth showing only once somebody else has ridden it too. */
const show = computed(() => (standing.value?.of ?? 0) > 1)
const name = (r: Standing['rows'][number]): string =>
  r.me ? 'You' : playerName({
    firstName: r.player.firstName ?? '', lastName: r.player.lastName ?? '',
    displayName: r.player.displayName, username: r.player.username ?? '—',
  })
</script>

<template>
  <div v-if="show && standing" class="panel standing">
    <h2>Against everyone else</h2>
    <p class="lead">
      <b>{{ ordinal(standing.rank ?? 0) }}</b> of {{ standing.of }} recent {{ gameName }} rides by players
      around your level<template v-if="standing.beaten > 0">, ahead of {{ standing.beaten }} of them</template>.
    </p>
    <ol class="rows">
      <li v-for="r in standing.rows" :key="r.sessionId" class="row" :class="{ me: r.me, podium: r.rank <= 3 }">
        <span class="rank">{{ rankBadge(r.rank) }}</span>
        <RouterLink v-if="!r.me && r.player.username" class="who" :to="`/players/${r.player.username}`">
          {{ name(r) }} <span v-if="r.player.country">{{ flagOrCode(r.player.country) }}</span>
        </RouterLink>
        <span v-else class="who">{{ name(r) }}</span>
        <span class="dist">{{ u.distance(r.distance, sys, 1).text }}</span>
        <span class="dur">{{ u.duration(r.duration) }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.lead { margin: 0; }
.lead b { font-size: 1.15em; }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.row { display: grid; grid-template-columns: 34px 1fr auto auto; gap: 12px; align-items: center;
  padding: 6px 10px; border-radius: 10px; }
.row:nth-child(odd) { background: color-mix(in srgb, var(--text) 3%, transparent); }
.row.me { background: color-mix(in srgb, var(--page) 18%, transparent); box-shadow: inset 0 0 0 1px var(--page); font-weight: 800; }
.rank { font-weight: 900; text-align: center; }
.who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; text-decoration: none; }
a.who:hover { text-decoration: underline; }
.dist, .dur { font-variant-numeric: tabular-nums; }
.dur { color: var(--muted); }
</style>
