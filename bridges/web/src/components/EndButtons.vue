<script setup lang="ts">
/**
 * End the session from any bridge (PLAN.md §9.6): "End" completes it (saved to History, the game attaches
 * its picture); "Discard" drops it. Not "End ride": it may be a treadmill game. Both are two taps so a knock on a phone strapped to a
 * treadmill cannot end a workout: the first tap arms the button for a few seconds, the second confirms.
 */
import { onBeforeUnmount, ref } from 'vue'
import { endSession, store } from '../bridge'

const armed = ref<'complete' | 'discarded' | null>(null)
const busy = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function disarm(): void {
  armed.value = null
  if (timer) clearTimeout(timer)
  timer = null
}

async function tap(status: 'complete' | 'discarded'): Promise<void> {
  if (busy.value) return
  if (armed.value !== status) {
    disarm()
    armed.value = status
    timer = setTimeout(disarm, 5000)
    return
  }
  disarm()
  busy.value = true
  try {
    await endSession(status) // the tail sees the end on its next poll and shows the ended card
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(disarm)
</script>

<template>
  <button class="big block" :class="{ danger: armed === 'complete' }" data-test="end" :disabled="busy" @click="tap('complete')">
    {{ armed === 'complete' ? '■ Tap again to end' : '■ End' }}
  </button>
  <button class="ghost block" :class="{ danger: armed === 'discarded' }" data-test="discard" :disabled="busy" @click="tap('discarded')">
    {{ armed === 'discarded' ? "Tap again to discard (won't be saved)" : store.hosting ? 'Discard and close game' : 'Discard' }}
  </button>
</template>
