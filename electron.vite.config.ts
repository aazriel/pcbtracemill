import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
  '@workers': resolve(__dirname, 'src/workers')
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } }
  }
})
