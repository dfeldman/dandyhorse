import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// base './' so the build works from any folder (on Dandyhorse it will be /games/trailtrainer/).
//
// The avatar kit's MakeHuman assets are 300 MB, so public/mh and public/env are symlinks into
// libs/avatarkit/public rather than copies. Vite would dereference and copy them on build, which is
// why copyPublicDir is off and `npm run build` relinks them into dist/ afterwards (tools/link-assets.js).
// The baked route packages are small and checked in, so they are copied by that script too.
export default defineConfig({
  base: './',
  // the avatar kit builds bodies in a module worker, which rules out the default iife workers
  worker: { format: 'es' },
  server: {
    port: 5196,
    strictPort: true,
    // @dandyhorse/avatarkit is a file: dependency outside this app's folder, and its worker is fetched by path
    fs: { allow: [resolve(import.meta.dirname, '..')] },
  },
  preview: { port: 5197, strictPort: true },
  // Babylon comes in through the @babylonjs/core barrel (~7 MB, 1.5 MB gzipped), like the other games
  build: { chunkSizeWarningLimit: 7500, copyPublicDir: false },
})
