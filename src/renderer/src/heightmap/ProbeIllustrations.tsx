/** Small side-view drawings used in the probing instructions. Each is 140×80 user units. */

const W = 140
const H = 80

function Board({ y = 58 }: { y?: number }): React.JSX.Element {
  return (
    <>
      <rect x={10} y={y} width={120} height={10} fill="#a16207" opacity={0.55} />
      <rect x={10} y={y - 2} width={120} height={2.5} fill="#d97706" />
    </>
  )
}

function Bit({ tipY, x = 70 }: { tipY: number; x?: number }): React.JSX.Element {
  return (
    <g>
      <rect x={x - 9} y={tipY - 52} width={18} height={20} fill="#475569" rx={2} />
      <rect x={x - 3} y={tipY - 32} width={6} height={20} fill="#cbd5e1" />
      <path d={`M${x - 3} ${tipY - 12} L${x} ${tipY} L${x + 3} ${tipY - 12} Z`} fill="#e2e8f0" />
    </g>
  )
}

/** 1. Clip on the bit, wire to the copper, both to the controller's probe input. */
export function ConnectIllustration(): React.JSX.Element {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-36" aria-hidden>
      <Board />
      <Bit tipY={40} />
      {/* controller */}
      <rect x={104} y={6} width={30} height={18} rx={2} fill="#1e293b" stroke="#64748b" />
      <text x={119} y={18} fontSize={6} textAnchor="middle" fill="#94a3b8">
        PROBE
      </text>
      {/* clip on bit */}
      <rect x={72} y={18} width={6} height={4} fill="#ef4444" />
      <path d="M78 20 C 92 20, 96 14, 106 14" stroke="#ef4444" strokeWidth={1.5} fill="none" />
      {/* clip on copper */}
      <rect x={20} y={53} width={7} height={4} fill="#111827" stroke="#64748b" strokeWidth={0.5} />
      <path d="M23 53 C 23 30, 60 6, 108 20" stroke="#94a3b8" strokeWidth={1.5} fill="none" />
    </svg>
  )
}

/** 2. Touch the clip to the board: the controller shows the probe as triggered. */
export function ContinuityIllustration(): React.JSX.Element {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-36" aria-hidden>
      <Board />
      <rect x={14} y={6} width={50} height={22} rx={3} fill="#1e293b" stroke="#64748b" />
      <text x={22} y={20} fontSize={7} fill="#94a3b8">
        Probe
      </text>
      <circle cx={52} cy={17} r={5} fill="#22c55e">
        <animate
          attributeName="opacity"
          values="0.15;1;1;0.15"
          keyTimes="0;0.4;0.8;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 -10; 0 0; 0 0; 0 -10"
          keyTimes="0;0.4;0.8;1"
          dur="2s"
          repeatCount="indefinite"
        />
        <rect x={96} y={44} width={8} height={10} fill="#ef4444" />
        <path d="M100 44 C 100 30, 80 24, 64 20" stroke="#ef4444" strokeWidth={1.5} fill="none" />
      </g>
    </svg>
  )
}

/** 3. Jog above point 1 and set X/Y/Z zero on the copper. */
export function ZeroIllustration(): React.JSX.Element {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-36" aria-hidden>
      <Board />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 -14; 0 0; 0 0; 0 -14"
          keyTimes="0;0.5;0.8;1"
          dur="3s"
          repeatCount="indefinite"
        />
        <Bit tipY={56} x={34} />
      </g>
      <circle cx={34} cy={56} r={2.5} fill="#fb7185" />
      <text x={44} y={50} fontSize={7} fill="#fda4af">
        point 1 → Z = 0
      </text>
      <line x1={10} y1={74} x2={130} y2={74} stroke="#334155" strokeDasharray="2 2" />
    </svg>
  )
}

/** 4. Run the program: the bit taps down on a grid. */
export function RunIllustration(): React.JSX.Element {
  const xs = [22, 46, 70, 94, 118]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-36" aria-hidden>
      <path d="M10 58 Q 50 52 80 57 T 130 55 L130 68 L10 68 Z" fill="#a16207" opacity={0.55} />
      <path d="M10 58 Q 50 52 80 57 T 130 55" stroke="#d97706" strokeWidth={2.5} fill="none" />
      {xs.map((x) => (
        <circle key={x} cx={x} cy={x < 60 ? 55 : x < 100 ? 57 : 55} r={1.8} fill="#e2e8f0" />
      ))}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={xs.flatMap((x) => [`${x - 70} -10`, `${x - 70} 0`, `${x - 70} -10`]).join(';')}
          dur="5s"
          repeatCount="indefinite"
        />
        <Bit tipY={54} />
      </g>
    </svg>
  )
}

/** 5. Save the probe log. */
export function SaveLogIllustration(): React.JSX.Element {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-36" aria-hidden>
      <rect x={40} y={6} width={60} height={68} rx={3} fill="#0f172a" stroke="#64748b" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <text key={i} x={46} y={18 + i * 10} fontSize={6} fill="#7dd3fc" fontFamily="monospace">
          {`${(i * 10).toFixed(0).padStart(2, '0')},${i % 2 ? 10 : 0},-0.0${i}`}
        </text>
      ))}
      <path d="M104 40 h18 m-6 -6 l6 6 l-6 6" stroke="#34d399" strokeWidth={2} fill="none" />
    </svg>
  )
}

/** Left-panel explainer: a warped board vs. a flat planned cut. */
export function WarpIllustration(): React.JSX.Element {
  return (
    <svg viewBox="0 0 280 74" className="w-full" aria-hidden>
      <path d="M8 40 Q 80 26 140 38 T 272 34 L272 60 L8 60 Z" fill="#a16207" opacity={0.45} />
      <path d="M8 40 Q 80 26 140 38 T 272 34" stroke="#f59e0b" strokeWidth={3} fill="none" />
      {/* planned flat cut */}
      <line x1={8} y1={37} x2={272} y2={37} stroke="#f43f5e" strokeDasharray="4 3" strokeWidth={1.2} />
      {/* levelled cut follows the surface */}
      <path d="M8 42.5 Q 80 28.5 140 40.5 T 272 36.5" stroke="#34d399" strokeWidth={1.2} fill="none" />
      <g>
        <animateMotion dur="6s" repeatCount="indefinite" path="M0 0 L264 0" />
        <rect x={4} y={6} width={8} height={18} fill="#cbd5e1" />
        <path d="M4 24 L8 32 L12 24 Z" fill="#e2e8f0" />
      </g>
      <text x={10} y={70} fontSize={8} fill="#fb7185">
        - - flat cut: too deep / misses copper
      </text>
      <text x={170} y={70} fontSize={8} fill="#6ee7b7">
        — levelled: follows copper
      </text>
    </svg>
  )
}
