<script setup lang="ts">
// You against this player, in one line, and a way to take it further (PLAN.md §18.11).
//
// This started as a full head-to-head — board by board, game by game, eleven rows of who beat whom —
// and the owner was right that it was too much: "we don't want players all getting mad at each other."
// A ledger of every way somebody beats you is an argument waiting to happen between two people who came
// here to ride. So it is steady power, theirs beside yours, and that is all it says.
//
// The competitive urge goes somewhere better: challenge them, and they turn up among your competitors
// next time you ride. You measure yourself against them by riding, not by reading.
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { challenge, unchallenge } from '../profiles'
import * as u from '../units'
import type { Versus } from '../types'

const props = defineProps<{ username: string; name: string; challenged: boolean }>()
const emit = defineEmits<{ (e: 'challenged', v: boolean): void }>()

const v = ref<Versus | null>(null)
const loading = ref(true)
const busy = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    v.value = await api<Versus>(`/api/profiles/${encodeURIComponent(props.username)}/versus`)
  } catch {
    v.value = null      // a comparison is a bonus; a profile without one is still a profile
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.username, load)

const show = computed(() => v.value && !v.value.self && typeof v.value.mine === 'number')

const verdict = computed(() => {
  const x = v.value
  if (!x || x.leader === 'level') return 'You are about level'
  return x.leader === 'me' ? 'You are the stronger rider' : `${props.name} is the stronger rider`
})

async function toggleChallenge(): Promise<void> {
  if (busy.value) return
  busy.value = true
  const was = props.challenged
  emit('challenged', !was)              // move the button at once
  try {
    const r = was ? await unchallenge(props.username) : await challenge(props.username)
    emit('challenged', r.challenged)
  } catch {
    emit('challenged', was)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section v-if="!loading && show" class="panel versus">
    <h2>You and {{ name }}</h2>
    <div class="line">
      <span class="side" :class="{ lead: v!.leader === 'me' }">
        <b>{{ u.power(v!.mine!).text }}</b><span class="who">you</span>
      </span>
      <span class="vs" aria-hidden="true">v</span>
      <span class="side" :class="{ lead: v!.leader === 'them' }">
        <b>{{ u.power(v!.theirs!).text }}</b><span class="who">{{ name }}</span>
      </span>
    </div>
    <p class="verdict">{{ verdict }} — steady power, measured from what you have each ridden.</p>

    <div class="act">
      <button type="button" class="btn challenge" :class="{ on: challenged }" :disabled="busy"
              @click="toggleChallenge">
        {{ challenged ? 'Challenged' : `Challenge ${name}` }}
      </button>
      <span class="muted small">
        <template v-if="challenged">
          They will be among your competitors next time you ride, for that session only.
        </template>
        <template v-else>Put them among your competitors next time you ride.</template>
      </span>
    </div>
  </section>
</template>

<style scoped>
.versus h2 { margin: 0 0 10px; }
.line { display: flex; align-items: baseline; justify-content: center; gap: 22px; }
.side { display: flex; flex-direction: column; align-items: center; gap: 1px; opacity: 0.65; }
.side.lead { opacity: 1; }
.side b { font-size: 1.7em; font-weight: 900; font-variant-numeric: tabular-nums; }
.side.lead b { color: var(--page); }
.who { font-size: 0.8em; opacity: 0.75; }
.vs { opacity: 0.4; font-weight: 800; }
.verdict { margin: 8px 0 0; text-align: center; font-weight: 600; opacity: 0.85; }

.act { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-top: 14px; }
.challenge { border: 2px solid var(--page); background: none; color: var(--page); font-weight: 800; }
.challenge.on { background: var(--page); color: var(--on-page); }
.small { font-size: 0.86em; }
</style>
