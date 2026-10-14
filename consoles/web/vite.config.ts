import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Served by the Dandyhorse server at /consoles/web/. `npm run dev` serves the console from source and proxies the
// platform's APIs to `make serve` (DANDYHORSE_API to point it at another server). Not /consoles: that is this app's
// own base, and proxying it served the server's built copy instead of the source (as Flight Cycle's /games was).
const API = process.env.DANDYHORSE_API ?? 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '/games', '/bridges', '/avatars']

export default defineConfig({
  plugins: [vue()],
  base: '/consoles/web/',
  // the avatar designer builds bodies in a module worker (avatarkit), which rules out the default iife workers
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
    // avatarkit is linked from a sibling repo by scripts/link-siblings.mjs (AVATARKIT_DIR, default ../avatarkit beside dandyhorse). Its modules come through
    // node_modules, but its geometry worker is fetched by path (/@fs/…), which the dev server refuses unless allowed.
    fs: { allow: [resolve(import.meta.dirname, '../..'), resolve(process.env.AVATARKIT_DIR || resolve(import.meta.dirname, '../../../avatarkit'))] },
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
