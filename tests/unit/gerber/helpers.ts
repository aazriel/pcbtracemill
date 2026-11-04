import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const FIXTURES = resolve(__dirname, '../../../fixtures/gerber')

export function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8')
}

/** Minimal mm header used by inline tests. */
export const MM_HEADER = '%FSLAX46Y46*%\n%MOMM*%\n'
