<script setup lang="ts">
// The hosted game. A keyboard or gamepad at the big screen goes straight to it (games/kingdomtrek/INTEGRATION.md §4.3):
// the iframe takes the focus when it loads and whenever the bridge UI collapses back to it; focusGame never takes it
// while the bridge UI is expanded.
import { watch } from 'vue'
import { focusGame, store } from '../bridge'

watch(() => store.expanded, (expanded) => { if (!expanded) focusGame() }, { flush: 'post' })
</script>

<template>
  <!-- keep the iframe mounted; only the layout changes when the bridge is expanded -->
  <iframe class="game-frame" :class="{ hidden: store.expanded }" :src="store.gameUrl ?? 'about:blank'" allow="fullscreen; gamepad" title="game" @load="focusGame"></iframe>
</template>
