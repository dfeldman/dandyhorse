<script setup lang="ts">
// A number that counts up to its value the first time it appears, and animates again whenever it changes.
// Leaderboards and totals feel alive with it and dead without; it respects prefers-reduced-motion.
import { onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  value: number
  /** Turns the running number into the text to show (so it can carry units). */
  format?: (n: number) => string
  ms?: number
}>(), { ms: 700 })

const shown = ref(0)
let frame = 0
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

watch(() => props.value, (to, from) => {
  cancelAnimationFrame(frame)
  if (reduced || !Number.isFinite(to)) { shown.value = to; return }
  const start = performance.now()
  const base = Number.isFinite(from as number) ? (from as number) : 0
  const step = (now: number): void => {
    const f = Math.min(1, (now - start) / props.ms)
    // ease-out, so it arrives gently rather than stopping dead
    shown.value = base + (to - base) * (1 - (1 - f) ** 3)
    if (f < 1) frame = requestAnimationFrame(step)
    else shown.value = to
  }
  frame = requestAnimationFrame(step)
}, { immediate: true })

onUnmounted(() => cancelAnimationFrame(frame))
</script>

<template><span class="countup">{{ format ? format(shown) : Math.round(shown) }}</span></template>

<style scoped>
.countup { font-variant-numeric: tabular-nums; }
</style>
