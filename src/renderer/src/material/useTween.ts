import { useEffect, useRef, useState } from 'react'

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Smoothly animates a record of numbers towards `target` (ease-out cubic). Used by the live previews so
 * that every geometric change (size, offset, rotation, heights…) glides instead of jumping.
 */
export function useTween<T extends Record<string, number>>(target: T, ms = 380): T {
  const key = JSON.stringify(target)
  const [value, setValue] = useState<T>(target)
  const current = useRef<T>(target)

  useEffect(() => {
    const parsed = JSON.parse(key) as Record<string, number | null>
    const to = {} as Record<string, number>
    for (const [k, v] of Object.entries(parsed)) to[k] = typeof v === 'number' && Number.isFinite(v) ? v : 0
    const from = current.current as Record<string, number>
    const same = Object.keys(to).every((k) => from[k] === to[k])
    if (same || reducedMotion()) {
      current.current = to as T
      setValue(to as T)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      const v = {} as Record<string, number>
      for (const name of Object.keys(to)) {
        const a = from[name]
        v[name] = Number.isFinite(a) ? a + (to[name] - a) * e : to[name]
      }
      current.current = v as T
      setValue(v as T)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [key, ms])

  return value
}
