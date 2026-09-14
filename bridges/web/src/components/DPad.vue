<script setup lang="ts">
// Up / down / left / right, OK in the centre, Back below. CSS grid only (old phones). Holding an arrow repeats it
// (repeat.ts); Select and Back are one press per tap. `small`: the compact cross beside a menu prompt (keys stay one tap high).
import { onBeforeUnmount, ref, watch } from 'vue'
import { holdToRepeat } from '../repeat'
import type { RemoteButton } from '../types'

const props = withDefaults(defineProps<{ choices?: RemoteButton[]; disabled?: boolean; small?: boolean }>(), {
  choices: () => ['up', 'down', 'left', 'right', 'select', 'back'],
  disabled: false,
  small: false,
})
const emit = defineEmits<{ press: [button: RemoteButton] }>()
const flashing = ref<RemoteButton | null>(null)

function has(b: RemoteButton): boolean { return props.choices.includes(b) }
function press(b: RemoteButton): void {
  if (props.disabled) return
  flashing.value = b
  setTimeout(() => { if (flashing.value === b) flashing.value = null }, 300)
  emit('press', b)
}

// Arrows press on pointerdown and repeat while held; the click that follows is part of that press. A click with no
// pointer press before it (Enter / Space, or the remote's el.click(): e.detail 0) presses once. Select and Back press on click.
const hold = holdToRepeat<RemoteButton>(press)
const isArrow = (b: RemoteButton) => b === 'up' || b === 'down' || b === 'left' || b === 'right'
function down(b: RemoteButton, e: PointerEvent): void {
  if (!isArrow(b) || props.disabled || e.button !== 0) return
  hold.down(b)
}
function click(b: RemoteButton, e: MouseEvent): void {
  if (isArrow(b)) hold.click(b, e.detail > 0)
  else press(b)
}
// a key that is disabled or taken away while held never gets its pointerup
watch(() => [props.disabled, props.choices] as const, () => {
  const k = hold.held()
  if (k && (props.disabled || !has(k))) hold.up()
})
onBeforeUnmount(() => hold.up())

const CROSS: RemoteButton[] = ['up', 'left', 'select', 'right', 'down']
const ARROWS: Record<RemoteButton, string> = { up: '▲', down: '▼', left: '◀', right: '▶', select: 'Select', back: '‹ Back' }
const NAMES: Record<RemoteButton, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', select: 'Select', back: 'Back' }
</script>

<template>
  <div class="dpad-wrap" :class="{ small }">
    <div class="dpad">
      <template v-for="b in CROSS" :key="b">
        <button v-if="has(b)" class="key" :class="[b, { flash: flashing === b }]" :disabled="disabled" :aria-label="NAMES[b]"
          @pointerdown="down(b, $event)" @pointerup="hold.up(b)" @pointercancel="hold.up(b)" @pointerleave="hold.up(b)"
          @contextmenu.prevent @click="click(b, $event)">{{ small && b === 'select' ? 'OK' : ARROWS[b] }}</button>
      </template>
    </div>
    <button v-if="has('back')" class="key back" :class="{ flash: flashing === 'back' }" :disabled="disabled" @click="press('back')">{{ ARROWS.back }}</button>
  </div>
</template>

<style>
.dpad-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dpad { display: grid; grid-template-columns: repeat(3, minmax(64px, 88px)); grid-template-rows: repeat(3, minmax(64px, 88px)); gap: 8px; width: 100%; max-width: 280px; }
.dpad .key { min-height: 64px; border-radius: var(--radius); font-size: 24px; font-weight: 700; background: var(--accent); color: var(--accent-text); border: none; box-shadow: var(--shadow); padding: 0; -webkit-touch-callout: none; }
.dpad .key:hover { background: var(--accent-hover); }
/* a held arrow must not turn into a page pan (that cancels the pointer and stops the repeat) */
.dpad .up, .dpad .down, .dpad .left, .dpad .right { touch-action: none; }
.dpad .up { grid-column: 2; grid-row: 1; }
.dpad .left { grid-column: 1; grid-row: 2; }
.dpad .select { grid-column: 2; grid-row: 2; background: var(--panel-3); color: var(--text); font-size: 20px; }
.dpad .select:hover { background: var(--line); }
.dpad .right { grid-column: 3; grid-row: 2; }
.dpad .down { grid-column: 2; grid-row: 3; }
.dpad-wrap .back { min-height: 56px; width: 100%; max-width: 280px; border-radius: var(--radius); font-size: 18px; font-weight: 600; }
.dpad-wrap .key.flash { animation: flash 300ms ease-out; }
/* small: one tap target per key (56 px on a phone, 64 on a TV) */
.dpad-wrap.small { gap: 8px; }
.dpad-wrap.small .dpad { grid-template-columns: repeat(3, var(--tap)); grid-template-rows: repeat(3, var(--tap)); gap: 6px; width: auto; }
.dpad-wrap.small .dpad .key { min-height: var(--tap); border-radius: var(--radius-sm); font-size: 20px; }
.dpad-wrap.small .dpad .select { font-size: 17px; font-weight: 900; }
.dpad-wrap.small .back { min-height: var(--tap); max-width: calc(3 * var(--tap) + 12px); border-radius: var(--radius-sm); font-size: 16px; }
</style>
