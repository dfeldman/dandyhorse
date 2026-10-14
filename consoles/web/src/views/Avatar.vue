<script setup lang="ts">
// The avatar designer (avatarkit, the sibling repo) on its own console page, reached from Preferences. The kit renders into a
// shadow root on the host element, so its styles and the console's stay apart. It is a heavy page (Babylon and the
// MakeHuman assets), so it loads on demand: nothing here is in the console's main bundle.
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { loadAvatar, saveAvatar } from '../avatar'
import { claimPresses } from '../navigation'
import { readTheme, resolveTheme } from '../theme'

const router = useRouter()
const host = ref<HTMLElement | null>(null)
const error = ref<string | null>(null)
const saved = ref(false)
let designer: { dispose: () => void; press: (p: 'up' | 'down' | 'left' | 'right' | 'select' | 'back') => void } | null = null
let release: (() => void) | null = null

onMounted(async () => {
  try {
    const [{ mountDesigner }, { setAssetBase, setStudioHdri, STUDIO_HDRI }] = await Promise.all([
      import('avatarkit/designer'),
      import('avatarkit'),
    ])
    // the server serves ../avatarkit/public/ here (see servers/api-flask/dandyhorse/static.py)
    setAssetBase('/avatars/mh/')
    setStudioHdri(`/avatars/${STUDIO_HDRI}`)
    if (!host.value) return
    // the designer follows the console's own light/dark choice
    host.value.dataset.theme = resolveTheme(readTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches)
    designer = await mountDesigner(host.value, {
      title: 'Your avatar',
      // the console maps the arrow keys itself (they are the bridge remote's too) and forwards them below
      arrows: false,
      initial: await loadAvatar(),
      // the designer says "Saved ✓", or shows the message of anything thrown here
      onSave: async (spec) => {
        await saveAvatar(spec)
        saved.value = true
      },
    })
    // the bridge's d-pad drives the designer while this page is up; Back still belongs to the console, so
    // the remote can always leave
    release = claimPresses((p) => {
      if (p === 'back' || !designer) return false
      designer.press(p)
      return true
    })
  } catch (e) {
    error.value = (e as Error).message
  }
})
onUnmounted(() => { release?.(); designer?.dispose() })

function back(): void {
  if (window.history.length > 1) router.back()
  else void router.push('/preferences')
}
</script>

<template>
  <section class="page page-avatar">
    <div class="actions">
      <button type="button" class="btn back" @click="back">Back</button>
      <span v-if="saved" class="pill ok">Saved to your profile</span>
    </div>
    <p v-if="error" class="notice error">The designer didn’t load: {{ error }}</p>
    <div ref="host" class="designer-host"></div>
  </section>
</template>

<style scoped>
/* The designer lays itself out to the full height of its host, so the host needs a definite one (with only a
   min-height its stage grows with the controls beside it and the avatar ends up far down a very tall canvas).
   On phones it stacks the stage over the controls and scrolls the controls inside itself, so it wants a
   definite height there too — otherwise the avatar scrolls off the top the moment you touch a slider. */
.designer-host { height: min(78vh, 900px); }
@media (max-width: 860px) {
  .designer-host { height: 82dvh; }
}
</style>
