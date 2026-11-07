import { readFileSync } from 'node:fs'
import { parseGerber } from './gerber'
import { analyzeClearance } from './toolpath'
for (const f of process.argv.slice(2)) {
  const t0 = Date.now()
  const r = analyzeClearance(parseGerber(readFileSync(f, 'utf8')).geometry)
  console.log(f, Date.now() - t0, 'ms', r)
}
