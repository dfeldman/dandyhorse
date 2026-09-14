<script setup lang="ts">
// Up / down / left / right, OK in the centre, Back below. CSS grid only (old phones).
import { ref } from 'vue'
import type { RemoteButton } from '../types'

const props = withDefaults(defineProps<{ choices?: RemoteButton[]; disabled?: boolean }>(), {
  choices: () => ['up', 'down', 'left', 'right', 'select', 'back'],
  disabled: false,
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
const ARROWS: Record<RemoteButton, string> = { up: '▲', down: '▼', left: '◀', right: '▶', select: 'Select', back: '‹ Back' }
</script>

<template>
  <div class="dpad-wrap">
    <div class="dpad">
      <button v-if="has('up')" class="key up" :class="{ flash: flashing === 'up' }" :disabled="disabled" aria-label="Up" @click="press('up')">{{ ARROWS.up }}</button>
      <button v-if="has('left')" class="key left" :class="{ flash: flashing === 'left' }" :disabled="disabled" aria-label="Left" @click="press('left')">{{ ARROWS.left }}</button>
      <button v-if="has('select')" class="key select" :class="{ flash: flashing === 'select' }" :disabled="disabled" aria-label="Select" @click="press('select')">{{ ARROWS.select }}</button>
      <button v-if="has('right')" class="key right" :class="{ flash: flashing === 'right' }" :disabled="disabled" aria-label="Right" @click="press('right')">{{ ARROWS.right }}</button>
      <button v-if="has('down')" class="key down" :class="{ flash: flashing === 'down' }" :disabled="disabled" aria-label="Down" @click="press('down')">{{ ARROWS.down }}</button>
    </div>
    <button v-if="has('back')" class="key back" :class="{ flash: flashing === 'back' }" :disabled="disabled" @click="press('back')">{{ ARROWS.back }}</button>
  </div>
</template>

<style>
.dpad-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dpad { display: grid; grid-template-columns: repeat(3, minmax(64px, 88px)); grid-template-rows: repeat(3, minmax(64px, 88px)); gap: 8px; width: 100%; max-width: 280px; }
.dpad .key { min-height: 64px; border-radius: var(--radius); font-size: 24px; font-weight: 700; background: var(--accent); color: var(--accent-text); border: none; box-shadow: var(--shadow); padding: 0; }
.dpad .key:hover { background: var(--accent-hover); }
.dpad .up { grid-column: 2; grid-row: 1; }
.dpad .left { grid-column: 1; grid-row: 2; }
.dpad .select { grid-column: 2; grid-row: 2; background: var(--panel-3); color: var(--text); font-size: 20px; }
.dpad .select:hover { background: var(--line); }
.dpad .right { grid-column: 3; grid-row: 2; }
.dpad .down { grid-column: 2; grid-row: 3; }
.dpad-wrap .back { min-height: 56px; width: 100%; max-width: 280px; border-radius: var(--radius); font-size: 18px; font-weight: 600; }
.dpad-wrap .key.flash { animation: flash 300ms ease-out; }
</style>
