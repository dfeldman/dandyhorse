<script lang="ts">
import { shallowRef } from 'vue'
// The largest countdown seen for the list on screen. Module scope, so it outlives each card: the one on Home unmounts
// while the game has the screen and the strip's sheet exists only while open, and a card that appears mid-countdown
// still shows the right fraction when an earlier card saw the countdown start.
const countdownFull = shallowRef({ key: '', value: 0 })
</script>

<script setup lang="ts">
// A menu prompt (games/kingdomtrek/INTEGRATION.md §4.2): the game's whole choice list, mirrored on the phone. One big
// button per item (a tap answers with the item's id), the game's highlight marked with its hint and kept in view, a
// Back button bound to the list's back item, a small d-pad for the buttons the game names, and a bar while the list
// goes on by itself. Every answer carries the rev on screen, so the game can drop a tap aimed at a list that has since
// changed. Menus are persistent: every tap counts, none waits for another.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { answerPrompt } from '../bridge'
import type { RequestedInput } from '../types'
import { menuPadButtons, scrollToShow } from '../ui'
import DPad from './DPad.vue'

const props = defineProps<{ prompt: RequestedInput; active: boolean; compact?: boolean }>()
const emit = defineEmits<{ answered: [] }>()

const items = computed(() => props.prompt.items ?? [])
const backItem = computed(() => items.value.find((it) => it.id === props.prompt.back) ?? null)
const pad = computed(() => menuPadButtons(props.prompt.choices, !!backItem.value))
const flashing = ref<string | null>(null)

async function choose(choice: string): Promise<void> {
  const p = props.prompt
  flashing.value = choice
  setTimeout(() => { if (flashing.value === choice) flashing.value = null }, 300)
  if (await answerPrompt(p.promptId, choice, p.rev)) emit('answered')
}

// The countdown is re-sent on every poll: the bar shows it against the largest value seen for this list.
watch(() => [props.prompt.promptId, props.prompt.rev, props.prompt.countdown] as const, ([id, rev, c]) => {
  const key = `${id}:${rev}`
  const f = countdownFull.value
  countdownFull.value = c == null ? { key: '', value: 0 } : { key, value: f.key === key ? Math.max(f.value, c) : c }
}, { immediate: true })
const countdownPct = computed(() => {
  const c = props.prompt.countdown
  const full = countdownFull.value.value
  return c == null || full <= 0 ? 0 : Math.min(100, (100 * c) / full)
})

// Keep the highlighted item in view. Only the list scrolls, never the page. It glides when the game moves the
// highlight within the list on screen, and is there at once for a new list or a list just shown (mounted, or the Home
// tab shown again after another tab: the ResizeObserver sees it get its size).
const list = ref<HTMLElement | null>(null)
function showHighlight(smooth: boolean): void {
  const box = list.value
  const i = items.value.findIndex((it) => it.id === props.prompt.highlight)
  const el = box && i >= 0 ? (box.children[i] as HTMLElement | undefined) : undefined
  if (!box || !el || box.clientHeight === 0) return
  const top = scrollToShow(box.scrollTop, box.clientHeight, el.offsetTop, el.offsetHeight)
  if (top === box.scrollTop) return
  if (!smooth) box.style.scrollBehavior = 'auto'
  box.scrollTop = top
  box.style.scrollBehavior = ''
}
watch(() => [props.prompt.promptId, props.prompt.rev, props.prompt.highlight] as const, (now, old) => {
  showHighlight(!!old && old[0] === now[0] && old[1] === now[1])
}, { flush: 'post' })
let resize: ResizeObserver | null = null
onMounted(() => {
  showHighlight(false)
  if (typeof ResizeObserver !== 'undefined' && list.value) {
    resize = new ResizeObserver(() => showHighlight(false))
    resize.observe(list.value)
  }
})
onBeforeUnmount(() => resize?.disconnect())
</script>

<template>
  <div class="card prompt menu-prompt" :class="{ compact }" data-test="prompt" data-layout="menu">
    <h3 v-if="!compact">Game controls</h3>
    <div class="title">{{ prompt.prompt || 'Choose' }}</div>
    <div v-if="prompt.countdown != null" class="countdown" role="timer" data-test="menu-countdown">
      <span class="bar"><i :style="{ width: countdownPct + '%' }"></i></span>
      <span class="num">{{ Math.ceil(prompt.countdown) }} s</span>
    </div>
    <div class="body">
      <div ref="list" class="items" data-test="menu-items">
        <button v-for="it in items" :key="it.id" class="item" :class="{ on: it.id === prompt.highlight, flash: flashing === it.id }"
          :disabled="!active || it.disabled" :aria-current="it.id === prompt.highlight ? 'true' : undefined" @click="choose(it.id)">
          <span class="label">{{ it.label }}</span>
          <span v-if="it.hint && it.id === prompt.highlight" class="hint">{{ it.hint }}</span>
        </button>
      </div>
      <div v-if="backItem || pad.length" class="foot">
        <button v-if="backItem" class="back" :class="{ flash: flashing === backItem.id }" :disabled="!active || backItem.disabled"
          data-test="menu-back" @click="choose(backItem.id)">‹ {{ backItem.label }}</button>
        <DPad v-if="pad.length" small :choices="pad" :disabled="!active" @press="choose" />
      </div>
    </div>
    <p v-if="!active" class="note">Choices work once the game is running.</p>
  </div>
</template>

<style>
/* The list scrolls inside the card, so a 20-item menu leaves Back and the d-pad on the first screen of a phone (the
   header, title and d-pad take about 450 px) and Pause / End one scroll away; in the strip's sheet it is capped so
   the whole sheet fits a phone. Flex only (old phones). */
.menu-prompt .title { margin-bottom: 12px; }
.menu-prompt .countdown { display: flex; align-items: center; gap: 10px; margin: -2px 0 12px; }
.menu-prompt .countdown .bar { flex: 1; height: 10px; border-radius: 999px; background: var(--panel-3); overflow: hidden; }
.menu-prompt .countdown .bar i { display: block; height: 100%; background: var(--page); border-radius: inherit; transition: width 1s linear; }
.menu-prompt .countdown .num { font-weight: 900; font-variant-numeric: tabular-nums; min-width: 3.5ch; text-align: right; }
.menu-prompt .body { display: flex; flex-direction: column; gap: 12px; }
.menu-prompt .items {
  position: relative; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; scroll-behavior: smooth;
  max-height: max(260px, calc(100vh - 450px)); max-height: max(260px, calc(100dvh - 450px)); padding: 6px; margin: -6px;
}
.menu-prompt.compact .items {
  max-height: max(150px, calc(100vh - var(--strip-h) - 370px)); max-height: max(150px, calc(100dvh - var(--strip-h) - 370px));
}
.menu-prompt .item {
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; flex: none;
  width: 100%; min-height: calc(var(--tap) + 8px); padding: 8px 18px; border-radius: var(--radius-sm); border: 3px solid transparent;
  background: var(--panel-2); color: var(--text); text-align: left; white-space: normal; line-height: 1.2;
  font-size: calc(var(--fs) * 1.1); font-weight: 800;
}
.menu-prompt .item:hover { background: var(--panel-3); }
.menu-prompt .item.on { background: var(--page); color: var(--on-page); border-color: color-mix(in srgb, #fff 45%, var(--page)); }
.menu-prompt .item.on:hover { background: var(--page); filter: brightness(1.08); }
.menu-prompt .item .hint { font-size: 0.8em; font-weight: 600; opacity: 0.92; }
.menu-prompt .item.flash, .menu-prompt .back.flash { animation: flash 300ms ease-out; }
.menu-prompt .foot { display: flex; align-items: center; justify-content: center; gap: 12px; }
.menu-prompt .foot .back {
  flex: 1 1 0; min-width: 0; min-height: calc(var(--tap) + 8px); padding: 8px 16px; border-radius: var(--radius-sm);
  white-space: normal; line-height: 1.15;
}
.menu-prompt .foot .dpad-wrap { flex: none; }
/* wide screens (a phone on its side, the TV): the d-pad and Back sit beside the list */
@media (min-width: 560px) {
  .menu-prompt .body { flex-direction: row; align-items: flex-start; }
  .menu-prompt .items { flex: 1 1 auto; min-width: 0; }
  .menu-prompt .foot { flex: none; width: calc(3 * var(--tap) + 24px); flex-direction: column-reverse; align-items: stretch; }
  .menu-prompt .foot .back { flex: none; }
  .menu-prompt .items { max-height: max(260px, calc(100vh - 280px)); max-height: max(260px, calc(100dvh - 280px)); }
  .menu-prompt.compact .items {
    max-height: max(150px, calc(100vh - var(--strip-h) - 190px)); max-height: max(150px, calc(100dvh - var(--strip-h) - 190px));
  }
}
@media (prefers-reduced-motion: reduce) {
  .menu-prompt .items { scroll-behavior: auto; }
}
</style>
