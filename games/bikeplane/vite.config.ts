import { defineConfig } from 'vite'

const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '/games', '/consoles', '/bridges']

export default defineConfig({
  base: '/games/bikeplane/',
  server: {
    port: 5177,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
