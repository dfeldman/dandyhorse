<script setup lang="ts">
// The "remote": the game's current choice input. Big full-width targets; a d-pad when the game asks for one; the
// game's whole list for a menu (MenuPrompt). One-shot choices hide locally as soon as the answer is accepted (the
// server clears the prompt on its next poll).
import { computed, ref, watch } from 'vue'
import { answerPrompt, store } from '../bridge'
import type { RemoteButton } from '../types'
import DPad from './DPad.vue'
import MenuPrompt from './MenuPrompt.vue'

const props = defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ answered: [] }>()

const prompt = computed(() => store.state?.requestedInput ?? null)
const active = computed(() => store.session?.status === 'active' || store.session?.status === 'paused')
const answered = ref<string | null>(null)
const flashing = ref<string | null>(null)
const busy = ref(false)
watch(() => prompt.value?.promptId, () => { answered.value = null })

const visible = computed(() => !!prompt.value && (prompt.value.persistent || answered.value !== prompt.value.promptId))
const isMenu = computed(() => prompt.value?.layout === 'menu')
const isDpad = computed(() => prompt.value?.layout === 'dpad')
const dpadChoices = computed(() => (prompt.value?.choices ?? []).filter((c): c is RemoteButton => ['up', 'down', 'left', 'right', 'select', 'back'].includes(c)))
const extraChoices = computed(() => (isDpad.value ? (prompt.value?.choices ?? []).filter((c) => !dpadChoices.value.includes(c as RemoteButton)) : prompt.value?.choices ?? []))

async function choose(choice: string): Promise<void> {
  const p = prompt.value
  if (!p) return
  // One-shot prompts: one tap, one request (a second tap while it is in flight would only be rejected).
  // Persistent prompts and d-pads: every tap counts, so never drop one behind an in-flight request.
  if (!p.persistent && busy.value) return
  flashing.value = choice
  setTimeout(() => { if (flashing.value === choice) flashing.value = null }, 300)
  if (!p.persistent) busy.value = true
  const ok = await answerPrompt(p.promptId, choice)
  busy.value = false
  if (ok && !p.persistent) answered.value = p.promptId
  if (ok) emit('answered')
}
</script>

<template>
  <MenuPrompt v-if="prompt && isMenu" :prompt="prompt" :active="active" :compact="props.compact" @answered="emit('answered')" />
  <div v-else-if="prompt && visible" class="card prompt" :class="{ compact: props.compact }" data-test="prompt">
    <h3>{{ prompt.persistent ? 'Game controls' : 'The game asks' }}</h3>
    <div class="title">{{ prompt.prompt || 'Choose' }}</div>
    <DPad v-if="isDpad" :choices="dpadChoices" :disabled="!active" @press="choose" />
    <div v-if="extraChoices.length" class="choices" :class="{ two: extraChoices.length === 2 && !isDpad }" :style="isDpad ? 'margin-top: 12px' : ''">
      <button v-for="c in extraChoices" :key="c" class="choice" :class="{ flash: flashing === c }" :disabled="!active || (busy && !prompt?.persistent)" @click="choose(c)">{{ c }}</button>
    </div>
    <p v-if="!active" class="note">Choices work once the game is running.</p>
  </div>
</template>
