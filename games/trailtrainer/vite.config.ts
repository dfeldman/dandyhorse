import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// base './' so the build works from any folder (on Dandyhorse it will be /games/trailtrainer/).
//
// The avatar kit's MakeHuman assets are 300 MB, so public/mh and public/env are symlinks into the avatarkit
// repo (../avatarkit beside dandyhorse) rather than copies, and public/trees|plants|rocks into assetkit's
// generated libraries (only used with ?assets=local). Vite would dereference and copy them on build, which is
// why copyPublicDir is off and `npm run build` copies what a build needs into dist/ afterwards
// (tools/link-assets.js): the baked routes and the ground textures (both restored from the asset bucket).
export default defineConfig({
  base: './',
  // the avatar kit builds bodies in a module worker, which rules out the default iife workers
  worker: { format: 'es' },
  server: {
    port: 5196,
    strictPort: true,
    // avatarkit is a file: dependency in the sibling avatarkit repo, and its worker is fetched by path
    fs: { allow: [resolve(import.meta.dirname, '../..'), resolve(import.meta.dirname, '../../../avatarkit')] },
  },
  preview: { port: 5197, strictPort: true },
  // Babylon comes in through the @babylonjs/core barrel (~7 MB, 1.5 MB gzipped), like the other games
  build: { chunkSizeWarningLimit: 7500, copyPublicDir: false },
})
