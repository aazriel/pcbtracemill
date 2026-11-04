import { useTween } from '@renderer/material/useTween'

const SURFACE = 122
const SPAN = 104

/**
 * Side view of the board with the three standard heights drawn above the copper surface (Z0).
 * The bit hops between travel and safe height; lines glide when values change.
 */
export function HeightsIllustration({
  safeZ,
  travelZ,
  toolChangeZ
}: {
  safeZ: number
  travelZ: number
  toolChangeZ: number
}): React.JSX.Element {
  const clean = (v: number): number => (Number.isFinite(v) ? Math.max(0, v) : 0)
  const t = useTween({ safe: clean(safeZ), travel: clean(travelZ), change: clean(toolChangeZ) })
  const maxZ = Math.max(t.safe, t.travel, t.change, 1) * 1.12
  // Square-root scale so small hops (2 mm) and a high tool-change height (30 mm) are both readable.
  const y = (z: number): number => SURFACE - SPAN * Math.sqrt(Math.max(0, z) / maxZ)

  const lines = [
    { key: 'change', z: t.change, raw: toolChangeZ, label: 'Tool change Z', color: '#a78bfa' },
    { key: 'safe', z: t.safe, raw: safeZ, label: 'Safe Z', color: '#38bdf8' },
    { key: 'travel', z: t.travel, raw: travelZ, label: 'Travel Z', color: '#34d399' }
  ]
  // Keep labels from overlapping (top to bottom, at least 12 px apart).
  const labelY: number[] = []
  ;[...lines]
    .map((l, i) => ({ i, y: y(l.z) }))
    .sort((a, b) => a.y - b.y)
    .forEach((l, n, arr) => {
      const prev = n ? labelY[arr[n - 1].i] : -Infinity
      labelY[l.i] = Math.max(l.y, prev + 12)
    })

  const yT = y(t.travel)
  const yS = y(t.safe)
  const fmt = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—')

  return (
    <svg viewBox="0 0 320 150" className="h-auto w-full" role="img" aria-label="Heights side view">
      <defs>
        <linearGradient id="hz-fr4" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f5a2a" />
          <stop offset="1" stopColor="#2a3d1c" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="320" height="150" fill="#0b1220" rx="6" />
      {/* board */}
      <rect x="10" y={SURFACE + 2} width="300" height="14" fill="url(#hz-fr4)" />
      <rect x="10" y={SURFACE} width="300" height="2.5" fill="#d08a4a" />
      <line x1="10" x2="310" y1={SURFACE} y2={SURFACE} stroke="#f0b37a" strokeWidth="1" />
      <text x="16" y={SURFACE + 12} fontSize="8.5" fill="#cbd5e1">
        Z0 = top of the copper
      </text>

      {lines.map((l, i) => (
        <g key={l.key}>
          <line
            x1="70"
            x2="232"
            y1={y(l.z)}
            y2={y(l.z)}
            stroke={l.color}
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          <line x1="232" x2="238" y1={y(l.z)} y2={labelY[i]} stroke={l.color} strokeWidth="0.8" />
          <text x="241" y={labelY[i] + 3} fontSize="9" fill={l.color} fontWeight="600">
            {l.label} {fmt(l.raw)}
          </text>
        </g>
      ))}

      {/* bit + spindle hopping: travel → cut → travel → safe → travel */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          dur="3.2s"
          repeatCount="indefinite"
          keyTimes="0;0.2;0.35;0.55;0.75;1"
          values={`0 ${yT}; 0 ${SURFACE + 1.5}; 0 ${yT}; 0 ${yS}; 0 ${yS}; 0 ${yT}`}
        />
        <polygon points="135,0 132.5,-6 137.5,-6" fill="#e2e8f0" />
        <rect x="132.5" y="-20" width="5" height="14" fill="#cbd5e1" />
        <rect x="124" y="-44" width="22" height="24" rx="3" fill="#475569" stroke="#64748b" />
      </g>
      <text x="16" y="14" fontSize="8" fill="#64748b">
        Side view · heights not to scale
      </text>
    </svg>
  )
}
