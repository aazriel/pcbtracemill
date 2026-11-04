import { copperLabel, mm } from './materialIssues'
import { useTween } from './useTween'

/** Side cut through the material: FR4 core with copper on top (and bottom), copper drawn exaggerated. */
export function MaterialCrossSection({
  thickness,
  copperThickness,
  doubleSided
}: {
  thickness: number
  copperThickness: number
  doubleSided: boolean
}): React.JSX.Element {
  const safe = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0)
  const t = useTween({
    fr4: Math.min(46, Math.max(8, safe(thickness) * 22)),
    cu: Math.min(9, Math.max(2.5, safe(copperThickness) * 110)),
    bottom: doubleSided ? 1 : 0
  })
  const x0 = 44
  const x1 = 310
  const top = 22
  const cuB = t.cu * t.bottom
  const fr4Top = top + t.cu
  const fr4Bot = fr4Top + t.fr4
  return (
    <svg
      viewBox="0 0 520 96"
      className="mx-auto block h-auto max-h-[104px] w-full"
      role="img"
      aria-label="Material cross-section"
    >
      <defs>
        <pattern id="cs-fr4" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#4d6b2e" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#5f8238" strokeWidth="2" />
        </pattern>
      </defs>
      <text x={x0} y={12} fontSize={10} fill="#64748b">
        Cross-section (copper drawn thicker so you can see it)
      </text>
      {/* top copper */}
      <rect x={x0} y={top} width={x1 - x0} height={t.cu} fill="#e0a065" />
      <rect x={x0} y={fr4Top} width={x1 - x0} height={t.fr4} fill="url(#cs-fr4)" />
      <rect x={x0} y={fr4Bot} width={x1 - x0} height={cuB} fill="#e0a065" opacity={t.bottom} />
      {/* Z0 */}
      <line x1={x0 - 10} x2={x1 + 8} y1={top} y2={top} stroke="#38bdf8" strokeDasharray="4 3" />
      <text x={x0 - 12} y={top + 3} fontSize={10} fill="#38bdf8" textAnchor="end" fontWeight={700}>
        Z0
      </text>
      {/* brackets */}
      <line x1={x1 + 14} x2={x1 + 14} y1={top} y2={fr4Bot + cuB} stroke="#94a3b8" />
      <line x1={x1 + 10} x2={x1 + 18} y1={top} y2={top} stroke="#94a3b8" />
      <line x1={x1 + 10} x2={x1 + 18} y1={fr4Bot + cuB} y2={fr4Bot + cuB} stroke="#94a3b8" />
      <text x={x1 + 24} y={(top + fr4Bot + cuB) / 2 + 4} fontSize={11} fill="#e2e8f0" fontWeight={600}>
        Board {mm(thickness, 2)} mm thick
      </text>
      <line x1={x1 - 30} x2={x1 + 22} y1={top + t.cu / 2} y2={top - 8} stroke="#e0a065" strokeWidth={0.8} />
      <text x={x1 + 24} y={top - 6} fontSize={11} fill="#f0b37a" fontWeight={600}>
        Copper {copperLabel(copperThickness)}
      </text>
      <text x={x0 + 8} y={fr4Top + t.fr4 / 2 + 4} fontSize={10} fill="#dfe8c9" opacity={t.fr4 > 12 ? 1 : 0}>
        FR4 (fibreglass)
      </text>
      <text x={x0} y={fr4Bot + cuB + 14} fontSize={10} fill="#64748b">
        {doubleSided
          ? 'Copper on both sides — you will mill the bottom after flipping.'
          : 'Only the top copper is milled.'}
      </text>
    </svg>
  )
}
