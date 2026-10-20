<script setup lang="ts">
// The games, in two sections: cycling first, then the treadmill (PLAN.md §18).
//
// A player owns a bike trainer, a treadmill, or both, and on any given evening they already know which one
// they are getting on. So the machine is the top-level division rather than a pill in the corner of a card:
// you look at one section and ignore the other. A variant that runs on both machines is listed under both,
// because from the player's side it genuinely is a cycling game *and* a treadmill game.
//
// Neither section is ever hidden for want of the hardware — a player shopping for a treadmill should be
// able to see what they would get — but a section for a machine they have not got says so.
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import type { DeviceType, Game, GamesResponse, Variant } from '../types'
import { deviceTypeName, initialOf } from '../status'
import { store } from '../session'
import LaunchDialog from '../components/LaunchDialog.vue'
import HomeStrip from '../components/HomeStrip.vue'

const games = ref<Game[]>([])
const error = ref<string | null>(null)
const loading = ref(true)
const picked = ref<{ game: Game; variant: Variant } | null>(null)

onMounted(async () => {
  try {
    games.value = (await api<GamesResponse>('/api/games')).games
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

/** Cycling first: it is the machine most people here have, and the one the games were built around. */
const SECTIONS: { device: DeviceType; title: string; blurb: string }[] = [
  { device: 'bike', title: 'Cycling', blurb: 'On a bike trainer' },
  { device: 'treadmill', title: 'Treadmill', blurb: 'Walking or running' },
]

interface Playable { game: Game; variant: Variant; key: string }

/** Every variant that runs on this machine, in catalogue order. One that runs on both appears in both. */
function playable(device: DeviceType): Playable[] {
  const out: Playable[] = []
  for (const g of games.value) {
    for (const v of g.variants) {
      if (v.deviceTypes.includes(device)) out.push({ game: g, variant: v, key: `${g.id}:${v.id}` })
    }
  }
  return out
}

const sections = computed(() => SECTIONS
  .map((s) => ({ ...s, items: playable(s.device) }))
  .filter((s) => s.items.length > 0))

/** Whether the player has told us they own this machine. Unknown (nothing saved) counts as owning it. */
function owned(device: DeviceType): boolean {
  const mine = store.me?.preferences.ownedDeviceTypes
  return !mine || mine.length === 0 || mine.includes(device)
}

/** The other machines a variant also runs on — worth saying, since it is listed in both sections. */
function alsoOn(v: Variant, device: DeviceType): DeviceType[] {
  return v.deviceTypes.filter((d) => d !== device)
}

/** A short clip of a real session, if the game ships one. Its own, else the game's. */
function preview(p: Playable): string | null {
  return p.variant.previewUrl ?? p.game.previewUrl ?? null
}

/**
 * The card the pointer is over, so only that one's clip is loaded and playing.
 *
 * Preloading a dozen videos to play none of them would cost a great deal of a player's connection for
 * nothing, so the `<video>` does not exist until the pointer arrives.
 */
const hovered = ref<string | null>(null)

function enter(p: Playable): void {
  if (preview(p)) hovered.value = p.key
}

function leave(p: Playable): void {
  if (hovered.value === p.key) hovered.value = null
}

/** Start it muted from the beginning: a preview that resumes halfway through looks broken. */
function playFrom(el: Element | null): void {
  const v = el as HTMLVideoElement | null
  if (!v) return
  v.currentTime = 0
  // A refused autoplay is not a problem worth reporting: the still underneath is still there.
  void v.play().catch(() => undefined)
}
</script>

<template>
  <section class="page page-games">
    <HomeStrip />
    <div class="page-head">
      <h1>Games</h1>
      <span class="lead">Pick a game to play</span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <p v-else-if="games.length === 0" class="empty">No games installed yet.</p>

    <section v-for="s in sections" :key="s.device" class="machine">
      <div class="machine-head">
        <h2>{{ s.title }}</h2>
        <span class="muted">{{ s.blurb }} · {{ s.items.length }}</span>
        <span v-if="!owned(s.device)" class="muted note">
          You have not said you own a {{ deviceTypeName(s.device) }}.
        </span>
      </div>
      <div class="cards">
        <button
          v-for="p in s.items" :key="p.key" type="button" class="card"
          @click="picked = { game: p.game, variant: p.variant }"
        >
          <!-- A fixed 16/9 box, so swapping the still for a clip does not reflow the grid. -->
          <div class="shot" @pointerenter="enter(p)" @pointerleave="leave(p)">
            <img
              v-if="p.variant.screenshotUrl ?? p.game.screenshotUrl"
              :src="(p.variant.screenshotUrl ?? p.game.screenshotUrl)!" :alt="p.variant.name" loading="lazy"
            />
            <span v-else class="initial">{{ initialOf(p.game.name) }}</span>
            <!-- Over the still rather than instead of it, so there is never a blank frame while it loads. -->
            <video
              v-if="hovered === p.key && preview(p)" class="clip" :src="preview(p)!"
              muted loop playsinline preload="auto" aria-hidden="true"
              @canplay="playFrom($event.target as Element)"
            ></video>
            <span v-if="alsoOn(p.variant, s.device).length" class="pills">
              <span v-for="d in alsoOn(p.variant, s.device)" :key="d" class="pill device">
                also {{ deviceTypeName(d) }}
              </span>
            </span>
          </div>
          <div class="body">
            <div class="title">{{ p.variant.name }}</div>
            <div class="sub">{{ p.game.name }}</div>
          </div>
        </button>
      </div>
    </section>

    <LaunchDialog v-if="picked" :game="picked.game" :variant="picked.variant" @close="picked = null" />
  </section>
</template>

<style scoped>
.machine { margin-top: 22px; }
.machine:first-of-type { margin-top: 6px; }
.machine-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin-bottom: 10px; }
.machine-head h2 { margin: 0; }
.note { font-style: italic; }
/* The clip sits exactly over the still, so there is never a blank frame while it loads. */
.shot .clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
@media (prefers-reduced-motion: reduce) { .shot .clip { display: none; } }
</style>
