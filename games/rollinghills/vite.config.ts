import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Served by the Dandyhorse server at /games/rollinghills/. `npm run dev` serves the game from source and proxies
// the platform's APIs to `make serve`. Not /games: that is this game's own base, and proxying it would serve the
// server's built copy instead of the source.
const API = process.env.DANDYHORSE_API ?? 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '/consoles', '/bridges', '/avatars']

export default defineConfig({
  base: '/games/rollinghills/',
  // the avatar kit builds bodies in a module worker, which rules out the default iife workers
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 7500 },
  server: {
    port: 5176,
    strictPort: true,
    // avatarkit is linked from a sibling repo by scripts/link-siblings.mjs (AVATARKIT_DIR, default ../avatarkit beside dandyhorse), and its worker is fetched by path
    fs: { allow: [resolve(import.meta.dirname, '../..'), resolve(process.env.AVATARKIT_DIR || resolve(import.meta.dirname, '../../../avatarkit'))] },
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
