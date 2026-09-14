<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../session'
import { connection } from '../status'

// Reads store.current (polled by App.vue); shows the exercise device the bridges have connected.
const emit = defineEmits<{ open: [] }>()
const conn = computed(() => connection(store.current?.bridges ?? []))
const session = computed(() => store.current?.session ?? null)
</script>

<template>
  <button type="button" class="conn" :class="{ on: conn.connected }" :title="session ? `${session.gameName} · ${session.status}` : 'Live status'" @click="emit('open')">
    <span class="dot" aria-hidden="true"></span>
    <span class="label">{{ conn.label }}</span>
    <span v-if="conn.hrm" class="hr" title="Heart rate monitor connected" aria-label="Heart rate monitor connected"></span>
    <span v-if="session" class="pill" :class="session.status">{{ session.status === 'active' ? 'playing' : session.status }}</span>
  </button>
</template>
