import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// The sibling repos, from environment variables, defaulting to checkouts beside dandyhorse (no symlinks):
// AVATARKIT_DIR and ASSETKIT_DIR. Only the dev server's local-assets mode (?assets=local) reads them by path.
const sibling = (name: string, env: string): string => resolve(process.env[env] || resolve(import.meta.dirname, '..', '..', '..', name))
const AVATARKIT_DIR = sibling('avatarkit', 'AVATARKIT_DIR')
const ASSETKIT_DIR = sibling('assetkit', 'ASSETKIT_DIR')

// Served by the Dandyhorse server at /games/trailtrainer/ (from dist/). `npm run dev` serves the game from source
// at http://localhost:5196/games/trailtrainer/ and proxies the platform's APIs to `make serve`. Other games are
// proxied, but not this one: Vite's proxy runs before its base handling, so a plain '/games' key would hand this
// game's own pages to the server's built copy instead of the source. A key starting with ^ is a regular expression.
const API = process.env.DANDYHORSE_API ?? 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '^/games/(?!trailtrainer/)', '/consoles', '/bridges', '/avatars']

// The trees, plants, rocks and avatars come from the shared asset bucket (src/render/assetsource.ts); with
// ?assets=local the dev server reads them from the sibling repos through /@fs/. copyPublicDir is off and
// `npm run build` copies what a build needs into dist/ (tools/link-assets.js): the baked routes and the ground
// textures, both restored from the bucket by `make assets`.
export default defineConfig({
  base: '/games/trailtrainer/',
  define: { __AVATARKIT_DIR__: JSON.stringify(AVATARKIT_DIR), __ASSETKIT_DIR__: JSON.stringify(ASSETKIT_DIR) },
  // the avatar kit builds bodies in a module worker, which rules out the default iife workers
  worker: { format: 'es' },
  server: {
    port: 5196,
    strictPort: true,
    // avatarkit is linked from the sibling repo (AVATARKIT_DIR, by scripts/link-siblings.mjs), and its worker is fetched by path
    fs: { allow: [resolve(import.meta.dirname, '../..'), AVATARKIT_DIR, ASSETKIT_DIR] },
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
  preview: { port: 5197, strictPort: true },
  // Babylon comes in through the @babylonjs/core barrel (~7 MB, 1.5 MB gzipped), like the other games
  build: { chunkSizeWarningLimit: 7500, copyPublicDir: false },
})
