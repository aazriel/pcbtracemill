/** Timeline / trail colours. Steps and tools use two separate palettes so they never look alike. */

const STEP_COLORS = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#22d3ee', // cyan
  '#fb7185', // rose
  '#a3e635', // lime
  '#818cf8', // indigo
  '#f97316' // orange
]

const TOOL_COLORS = ['#facc15', '#e879f9', '#2dd4bf', '#f87171', '#60a5fa', '#bef264', '#fdba74', '#c4b5fd']

export const stepColor = (i: number): string => STEP_COLORS[i % STEP_COLORS.length]
export const toolColor = (i: number): string => TOOL_COLORS[i % TOOL_COLORS.length]

/** Colour used for the "board flipped" marker. */
export const FLIP_COLOR = '#f8fafc'

/** "#rrggbb" → "rgba(r,g,b,a)". */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
