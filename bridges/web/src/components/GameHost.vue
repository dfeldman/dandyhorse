<script setup lang="ts">
import { store } from '../bridge'
</script>

<template>
  <!-- keep the iframe mounted; only the layout changes when the bridge is expanded -->
  <iframe class="game-frame" :class="{ hidden: store.expanded }" :src="store.gameUrl ?? 'about:blank'" allow="fullscreen" title="game"></iframe>
</template>
