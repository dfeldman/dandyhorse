import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/games', '/consoles', '/bridges']

export default defineConfig({
  plugins: [vue()],
  base: '/bridges/web/',
  server: {
    port: 5174,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
    // devicelib is linked from ../../devicelib (file: dependency); the dev server must be allowed to read it
    fs: { allow: ['.', '../../devicelib'] },
  },
})
