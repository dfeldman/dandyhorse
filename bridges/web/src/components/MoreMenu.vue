<script setup lang="ts">
// The ⋯ menu: developer tools, theme, technical details, rename.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { setDevTools, setLabel, setTechDetails, setTheme, store, type Tab, type Theme } from '../bridge'

const open = ref(false)
const renaming = ref(false)
const draft = ref('')

function openTool(tab: Tab): void {
  store.tab = tab
  open.value = false
}
function startRename(): void {
  draft.value = store.label
  renaming.value = true
  open.value = false
}
function saveRename(): void {
  setLabel(draft.value)
  renaming.value = false
}
function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') { open.value = false; renaming.value = false } }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
const THEMES: { id: Theme; label: string }[] = [{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]
</script>

<template>
  <div class="menu-wrap">
    <button class="more" :class="{ active: open }" aria-label="More" aria-haspopup="menu" :aria-expanded="open" data-test="more" @click="open = !open">⋯</button>
    <template v-if="open">
      <div class="backdrop" @click="open = false"></div>
      <div class="menu" role="menu" data-test="menu">
        <button class="item" role="menuitemcheckbox" :aria-checked="store.devTools" @click="setDevTools(!store.devTools)">
          <span>Developer tools</span><span v-if="store.devTools" class="check">✓</span>
        </button>
        <template v-if="store.devTools">
          <button class="item" role="menuitem" @click="openTool('debug')"><span>Debug Dandyhorse</span></button>
          <button class="item" role="menuitem" @click="openTool('ftms')"><span>Exercise device console</span></button>
        </template>
        <hr />
        <h3>Theme</h3>
        <div class="seg" role="radiogroup">
          <button v-for="t in THEMES" :key="t.id" :class="{ active: store.theme === t.id }" role="radio" :aria-checked="store.theme === t.id" @click="setTheme(t.id)">{{ t.label }}</button>
        </div>
        <hr />
        <button class="item" role="menuitemcheckbox" :aria-checked="store.techDetails" @click="setTechDetails(!store.techDetails)">
          <span>Show technical details</span><span v-if="store.techDetails" class="check">✓</span>
        </button>
        <button class="item" role="menuitem" @click="startRename"><span>Rename this bridge</span></button>
      </div>
    </template>
  </div>
  <div v-if="renaming" class="modal-back" @click.self="renaming = false">
    <form class="modal" @submit.prevent="saveRename">
      <h2>Rename this bridge</h2>
      <p class="muted small">Other devices and the console see this name.</p>
      <label class="field"><span>Name</span><input type="text" v-model="draft" maxlength="60" autofocus /></label>
      <div class="row" style="justify-content: flex-end">
        <button type="button" @click="renaming = false">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </div>
</template>
