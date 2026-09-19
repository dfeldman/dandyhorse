import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Served by the Dandyhorse server at /consoles/web/. `npm run dev` serves the console from source and proxies the
// platform's APIs to `make serve` (DANDYHORSE_API to point it at another server). Not /consoles: that is this app's
// own base, and proxying it served the server's built copy instead of the source (as Flight Cycle's /games was).
// (the config runs in node; the console's own types are the browser's, so declare just this much)
declare const process: { env: Record<string, string | undefined> }
const API = process.env.DANDYHORSE_API ?? 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '/games', '/bridges', '/avatars']

export default defineConfig({
  plugins: [vue()],
  base: '/consoles/web/',
  // the avatar designer builds bodies in a module worker (libs/avatarkit), which rules out the default iife workers
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
