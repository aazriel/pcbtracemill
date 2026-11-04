/**
 * Persistence of the user's own machine profiles across sessions.
 * Electron: window.tracemill.settingsGet/settingsSet('customMachines'); browser: localStorage fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MachineProfile } from '@core/model/types'
import { MACHINE_PRESETS } from '@core/machines'

const KEY = 'customMachines'
const LS_KEY = 'tracemill.customMachines'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Fills missing fields from the Generic preset so older / partial records stay usable. */
function normalise(raw: unknown): MachineProfile | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  const base = MACHINE_PRESETS.find((m) => m.id === 'preset-generic') ?? MACHINE_PRESETS[0]
  const wa = isRecord(raw.workArea) ? raw.workArea : {}
  return {
    ...base,
    ...(raw as Partial<MachineProfile>),
    workArea: { ...base.workArea, ...(wa as Partial<MachineProfile['workArea']>) },
    builtIn: false
  }
}

export async function loadCustomMachines(): Promise<MachineProfile[]> {
  let raw: unknown = []
  try {
    if (window.tracemill) raw = await window.tracemill.settingsGet<unknown>(KEY, [])
    else raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
  } catch {
    raw = []
  }
  if (!Array.isArray(raw)) return []
  return raw.map(normalise).filter((m): m is MachineProfile => m !== null)
}

export async function saveCustomMachines(list: MachineProfile[]): Promise<void> {
  try {
    if (window.tracemill) await window.tracemill.settingsSet(KEY, list)
    else localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable (private mode, quota…): keep working in memory.
  }
}

/** Custom machine list with load-on-mount and debounced save on change. */
export function useCustomMachines(): {
  machines: MachineProfile[]
  loaded: boolean
  setMachines: (next: MachineProfile[]) => void
} {
  const [machines, setState] = useState<MachineProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<MachineProfile[] | null>(null)

  useEffect(() => {
    let alive = true
    void loadCustomMachines().then((list) => {
      if (!alive) return
      setState(list)
      setLoaded(true)
    })
    return () => {
      alive = false
      // Flush a pending save when the dialog closes.
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) void saveCustomMachines(pending.current)
    }
  }, [])

  const setMachines = useCallback((next: MachineProfile[]) => {
    setState(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (pending.current) void saveCustomMachines(pending.current)
      pending.current = null
    }, 300)
  }, [])

  return { machines, loaded, setMachines }
}
