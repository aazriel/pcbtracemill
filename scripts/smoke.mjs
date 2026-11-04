// Browser smoke test / screenshot tool for the renderer (no Electron needed).
// Usage: node scripts/smoke.mjs [--stage board|manufacture|simulation|export] [--out file.png] [--no-import] [--eval "js"]
// Requires `npx electron-vite build` first. Serves out/renderer on a random port.
import { createServer } from 'node:http'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const stage = arg('--stage', 'board')
const out = arg('--out', `/tmp/tracemill-${stage}.png`)
const evalJs = arg('--eval', null)
const root = process.env.TM_OUT ? `${process.env.TM_OUT}/renderer` : 'out/renderer'
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
}
const server = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]))
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(root, 'index.html')
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' })
  res.end(readFileSync(p))
}).listen(0)
const port = server.address().port
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(`http://localhost:${port}/`)
await page.waitForFunction(() => !!window.__tm)
if (!args.includes('--no-import')) {
  const dir = 'fixtures/boards/demo-kicad'
  const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
  await page.evaluate(async (files) => {
    window.__tm.project.getState().setEdaTool('kicad')
    await window.__tm.importDropped(files)
  }, files)
  if (stage !== 'board') {
    await page.evaluate(async () => {
      window.__tm.applyRecipe()
      await window.__tm.regenerate()
    })
    await page.waitForFunction(() => !!window.__tm.ui.getState().cam, null, { timeout: 30000 })
  }
}
await page.evaluate((s) => window.__tm.ui.getState().set({ stage: s }), stage)
if (evalJs) await page.evaluate(evalJs)
await page.waitForTimeout(Number(arg('--wait', 1500)))
await page.screenshot({ path: out })
console.log(JSON.stringify({ screenshot: out, errors }, null, 1))
await browser.close()
server.close()
