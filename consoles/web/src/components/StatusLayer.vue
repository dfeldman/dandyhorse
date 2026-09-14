<script setup lang="ts">
import StatusPanel from './StatusPanel.vue'

// Small layer opened from the top-bar indicator; replaces the old Status page.
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="layer-backdrop" @click.self="emit('close')">
    <div class="layer page-status" role="dialog" aria-modal="true" aria-label="Live status" data-focus-layer>
      <StatusPanel />
      <button type="button" class="btn big" data-back @click="emit('close')">Close</button>
    </div>
  </div>
</template>
