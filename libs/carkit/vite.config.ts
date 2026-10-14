import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// base './' so the build works from any folder
export default defineConfig({
  base: './',
  server: { port: 5204, strictPort: true },
  preview: { port: 5205, strictPort: true },
  build: {
    chunkSizeWarningLimit: 7500,
    rollupOptions: { input: { demo: resolve(import.meta.dirname, 'index.html') } },
  },
})
