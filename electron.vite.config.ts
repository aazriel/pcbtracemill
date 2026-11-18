import { readFileSync } from 'node:fs'
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

// the app version, readable everywhere as APP_VERSION (src/shared/version.ts)
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
const define = { __APP_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias }, define },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias }, define },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    define,
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } }
  }
})
