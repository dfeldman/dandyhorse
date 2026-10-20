<script setup lang="ts">
// The activity feed (PLAN.md §18.2): what everybody has been doing, and who has cheered you.
//
// The profile timeline answers "what has this person been up to"; this answers "what is going on here",
// which is the question somebody has when they open the app and have not ridden yet. Nobody is motivated
// by an empty screen, so this is the page that shows the platform has other people on it.
//
// Private players are not here at all — that rule lives on the server, in social/feed.py, which explains
// why it differs from the leaderboards (where they are ranked under a pseudonym).
import { computed, onMounted, ref } from 'vue'
import { cheer, cheersForMe, feed, markCheersSeen, updateIcon } from '../profiles'
import { ago } from '../units'
import PlayerChip from '../components/PlayerChip.vue'
import type { CheerReceived, FeedEntry } from '../types'

const tab = ref<'everyone' | 'cheers'>('everyone')
const entries = ref<FeedEntry[]>([])
const more = ref(false)
const cheers = ref<CheerReceived[]>([])
const cheersMore = ref(false)
const unseen = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const [f, c] = await Promise.all([feed(), cheersForMe()])
    entries.value = f.entries
    more.value = f.more
    cheers.value = c.cheers
    cheersMore.value = c.more
    unseen.value = c.unseen
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

async function older(): Promise<void> {
  const last = entries.value[entries.value.length - 1]
  if (!last) return
  const next = await feed(last.id)
  entries.value = [...entries.value, ...next.entries]
  more.value = next.more
}

async function olderCheers(): Promise<void> {
  const last = cheers.value[cheers.value.length - 1]
  if (!last) return
  const next = await cheersForMe(last.mark)
  cheers.value = [...cheers.value, ...next.cheers]
  cheersMore.value = next.more
}

/** Opening the cheers tab is what counts as having looked at them. */
async function openCheers(): Promise<void> {
  tab.value = 'cheers'
  if (unseen.value === 0) return
  try {
    await markCheersSeen()
    unseen.value = 0
  } catch { /* the badge is not worth an error message */ }
}

async function rideOn(e: FeedEntry): Promise<void> {
  const was = { cheers: e.cheers, cheered: e.cheered }
  // Move the number straight away: a tap that does nothing for half a second feels broken.
  e.cheered = !e.cheered
  e.cheers += e.cheered ? 1 : -1
  try {
    const r = await cheer(e.id)
    e.cheers = r.cheers
    e.cheered = r.cheered
  } catch {
    Object.assign(e, was)
  }
}

/** The distance and time a session entry carries, when it has them, as one short line. */
function detail(e: FeedEntry): string {
  const d = e.data as { distance?: number; duration?: number }
  const bits: string[] = []
  if (typeof d.distance === 'number' && d.distance >= 100) bits.push(`${(d.distance / 1000).toFixed(1)} km`)
  if (typeof d.duration === 'number' && d.duration >= 60) bits.push(`${Math.round(d.duration / 60)} min`)
  return bits.join(' · ')
}

const nobody = computed(() => !loading.value && entries.value.length === 0)
</script>

<template>
  <section class="page page-feed">
    <div class="page-head">
      <h1>Activity</h1>
      <nav class="tabs" aria-label="Activity">
        <button type="button" :class="{ on: tab === 'everyone' }" @click="tab = 'everyone'">Everyone</button>
        <button type="button" :class="{ on: tab === 'cheers' }" @click="openCheers">
          Cheers for you
          <span v-if="unseen" class="badge">{{ unseen }}</span>
        </button>
      </nav>
    </div>

    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-else-if="tab === 'everyone'">
      <p v-if="nobody" class="muted">
        Nothing yet. Finish a session and you will be the first thing on here.
      </p>
      <ul v-else class="feed">
        <li v-for="e in entries" :key="e.id" class="entry" :class="{ mine: e.player.me }">
          <PlayerChip :player="e.player" size="sm" class="who" />
          <div class="body">
            <p class="text">
              <span class="icon" aria-hidden="true">{{ updateIcon(e.kind) }}</span>{{ e.text }}
            </p>
            <p class="meta">
              <RouterLink v-if="e.sessionId" :to="`/sessions/${e.sessionId}`">{{ ago(e.createdAt) }}</RouterLink>
              <span v-else>{{ ago(e.createdAt) }}</span>
              <span v-if="e.gameName" class="game">{{ e.gameName }}</span>
              <span v-if="detail(e)" class="muted">{{ detail(e) }}</span>
              <button type="button" class="rideon" :class="{ on: e.cheered }" @click="rideOn(e)">
                <span aria-hidden="true">👍</span>
                <span class="sr">Ride on</span>
                <template v-if="e.cheers">{{ e.cheers }}</template>
              </button>
            </p>
          </div>
        </li>
      </ul>
      <button v-if="more && entries.length" type="button" class="btn" @click="older">Older</button>
    </template>

    <template v-else>
      <p v-if="cheers.length === 0" class="muted">
        Nobody has cheered you yet. Post something, or finish a ride — the games write a line for you.
      </p>
      <ul v-else class="feed">
        <li v-for="c in cheers" :key="c.mark" class="entry">
          <PlayerChip :player="c.from" size="sm" class="who" />
          <div class="body">
            <p class="text"><span class="icon" aria-hidden="true">👍</span>cheered your update</p>
            <p class="quote">“{{ c.text }}”</p>
            <p class="meta"><span>{{ ago(c.at) }}</span></p>
          </div>
        </li>
      </ul>
      <button v-if="cheersMore && cheers.length" type="button" class="btn" @click="olderCheers">Older</button>
    </template>
  </section>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; }
.tabs button { border: 0; background: none; color: inherit; font: inherit; font-weight: 800; cursor: pointer;
  padding: 7px 14px; border-radius: 999px; opacity: 0.6; }
.tabs button.on { background: var(--page); color: var(--on-page); opacity: 1; }
.badge { display: inline-block; min-width: 18px; margin-left: 6px; padding: 0 5px; border-radius: 999px;
  background: #ff5d5d; color: #fff; font-size: 0.74em; font-weight: 900; text-align: center; }

.feed { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.entry { display: grid; grid-template-columns: minmax(130px, 190px) 1fr; gap: 14px; align-items: start;
  padding: 11px 14px; border-radius: 14px; background: var(--panel); box-shadow: var(--shadow);
  animation: in 0.25s ease both; }
.entry.mine { box-shadow: inset 0 0 0 1px var(--page), var(--shadow); }
.who { min-width: 0; }
.body { min-width: 0; }
.text { margin: 0; font-weight: 700; }
.icon { margin-right: 7px; }
.quote { margin: 2px 0 0; opacity: 0.75; font-style: italic; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 4px 0 0;
  font-size: 0.86em; opacity: 0.78; }
.game { font-weight: 700; }
.rideon { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; padding: 2px 6px;
  border-radius: 999px; font-weight: 800; }
.rideon:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
.rideon.on { background: color-mix(in srgb, #6ee7a8 35%, transparent); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@keyframes in { from { opacity: 0; transform: translateY(5px); } }
@media (prefers-reduced-motion: reduce) { .entry { animation: none; } }
@media (max-width: 620px) {
  .entry { grid-template-columns: 1fr; gap: 6px; }
}
</style>
