<script setup lang="ts">
// The avatar designer (libs/avatarkit) on its own console page, reached from Preferences. The kit renders into a
// shadow root on the host element, so its styles and the console's stay apart. It is a heavy page (Babylon and the
// MakeHuman assets), so it loads on demand: nothing here is in the console's main bundle.
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { readTheme, resolveTheme } from '../theme'

const router = useRouter()
const host = ref<HTMLElement | null>(null)
const error = ref<string | null>(null)
const saved = ref(false)
let designer: { dispose: () => void } | null = null

/** Where the avatar is kept for now: this browser. Storing it on the player's profile comes next. */
const KEY = 'dh.avatar'
function loadLocal(): unknown {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

onMounted(async () => {
  try {
    const [{ mountDesigner }, { setAssetBase, setStudioHdri, STUDIO_HDRI }] = await Promise.all([
      import('@dandyhorse/avatarkit/designer'),
      import('@dandyhorse/avatarkit'),
    ])
    // the server serves libs/avatarkit/public/ here (see servers/api-flask/dandyhorse/static.py)
    setAssetBase('/avatars/mh/')
    setStudioHdri(`/avatars/${STUDIO_HDRI}`)
    if (!host.value) return
    // the designer follows the console's own light/dark choice
    host.value.dataset.theme = resolveTheme(readTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches)
    designer = await mountDesigner(host.value, {
      title: 'Your avatar',
      initial: loadLocal(),
      onSave: (spec) => {
        localStorage.setItem(KEY, JSON.stringify(spec))
        saved.value = true
      },
    })
  } catch (e) {
    error.value = (e as Error).message
  }
})
onUnmounted(() => designer?.dispose())

function back(): void {
  if (window.history.length > 1) router.back()
  else void router.push('/preferences')
}
</script>

<template>
  <section class="page page-avatar">
    <div class="actions">
      <button type="button" class="btn back" @click="back">Back</button>
      <span v-if="saved" class="pill ok">Saved on this device</span>
    </div>
    <p v-if="error" class="notice error">The designer didn’t load: {{ error }}</p>
    <div ref="host" class="designer-host"></div>
  </section>
</template>

<style scoped>
/* The designer lays itself out to the full height of its host, so the host needs a definite one (with only a
   min-height its stage grows with the controls beside it and the avatar ends up far down a very tall canvas).
   On phones the designer stacks and sizes itself, so there it takes what it needs. */
.designer-host { height: min(78vh, 900px); }
@media (max-width: 860px) {
  .designer-host { height: auto; }
}
</style>
