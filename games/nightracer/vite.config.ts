import { defineConfig } from 'vite'

const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '/games', '/consoles', '/bridges']

export default defineConfig({
  base: '/games/nightracer/',
  server: {
    port: 5190,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
  // Babylon comes in through the @babylonjs/core barrel (~7 MB, 1.5 MB gzipped); subpath imports would shrink it
  build: { chunkSizeWarningLimit: 7500 },
})
