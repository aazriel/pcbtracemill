/**
 * One small animated illustration per machine setting, shown in the setting's (?) tooltip.
 * Purely descriptive settings (name, description) have none.
 */
import type { ReactNode } from 'react'
import type { MachineProfile } from '@core/model/types'
import { Bit, BoardSide, Code, Dial, Label, Scene, W } from '@renderer/components/illustrations/kit'
import { HeightsIllustration } from './HeightsIllustration'
import type { MachineFieldKey } from './machineMeta'

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

/** A highlight bar that walks down `n` code lines (y of first line, line pitch). */
function LineSweep({
  n,
  y0 = 22,
  pitch = 16,
  dur = 4
}: {
  n: number
  y0?: number
  pitch?: number
  dur?: number
}): React.JSX.Element {
  const ys = Array.from({ length: n }, (_, i) => y0 + i * pitch - 11)
  return (
    <rect x={8} width={W - 16} height={pitch} rx={2} fill="#38bdf8" opacity={0.12}>
      <animate
        attributeName="y"
        values={ys.join(';')}
        dur={`${dur}s`}
        repeatCount="indefinite"
        calcMode="discrete"
      />
    </rect>
  )
}

const FLAVOUR: Record<string, string[]> = {
  mach3: [
    '(Isolate traces)',
    'G21 G90 G94 G17 G40 G49 G80',
    'G91.1',
    'M3 S12000',
    'G0 Z5',
    'G81 X10 Y5 Z-1.8 R1 F100',
    'M30'
  ],
  grbl: ['(Isolate traces)', 'G21', 'G90 G94 G17', 'M3 S12000', 'G4 P2', 'G1 X10 Y5 F300', 'M30'],
  linuxcnc: [
    '(Isolate traces)',
    'G21 G90 G94 G17 G40 G49 G80',
    'G64 P0.01',
    'M3 S12000',
    'G0 Z5',
    'G1 X10 Y5 F300',
    'M2'
  ],
  generic: ['(Isolate traces)', 'G21', 'G90 G94 G17', 'M3 S12000', 'G0 Z5', 'G1 X10 Y5 F300', 'M30']
}

function codeFigure(lines: string[], caption: ReactNode, hl: number[] = []): ReactNode {
  return (
    <Scene caption={caption} height={Math.max(60, 16 + lines.length * 16)}>
      <LineSweep n={lines.length} />
      <Code lines={lines} hl={hl} />
    </Scene>
  )
}

function workArea(m: MachineProfile): ReactNode {
  const { x, y, z } = m.workArea
  const s = Math.min(200 / Math.max(1, x), 110 / Math.max(1, y))
  const bw = Math.max(30, x * s)
  const bh = Math.max(20, y * s)
  const x0 = 20
  const y0 = 18 + (110 - bh) / 2
  const path = `M ${x0} ${y0 + bh} L ${x0 + bw} ${y0 + bh} L ${x0 + bw} ${y0} L ${x0} ${y0} Z`
  return (
    <Scene caption="Seen from above: the bit can reach anywhere inside the bed; Z is how far it can move up and down.">
      <rect x={x0} y={y0} width={bw} height={bh} fill="#1e293b" stroke="#38bdf8" strokeDasharray="4 3" />
      <circle r={5} fill="#fbbf24">
        <animateMotion dur="5s" repeatCount="indefinite" path={path} />
      </circle>
      <Label x={x0 + bw / 2} y={y0 + bh + 14} anchor="middle" color="#7dd3fc">
        X {x} mm
      </Label>
      <Label x={x0 - 4} y={y0 + bh / 2} anchor="end" color="#7dd3fc">
        Y
      </Label>
      <Label x={x0 + bw / 2} y={y0 - 4} anchor="middle" color="#64748b">
        Y {y} mm
      </Label>
      <rect x={260} y={20} width={14} height={110} fill="#1e293b" stroke="#a78bfa" />
      <rect x={256} width={22} height={14} rx={2} fill="#a78bfa">
        <animate attributeName="y" values="22;114;22" dur="3s" repeatCount="indefinite" />
      </rect>
      <Label x={286} y={78} color="#c4b5fd">
        Z {z}
      </Label>
    </Scene>
  )
}

function feedXY(m: MachineProfile): ReactNode {
  const dur = clamp(4000 / Math.max(50, m.maxFeedXY), 0.8, 6)
  return (
    <Scene
      caption={`Sideways moves are never faster than ${m.maxFeedXY} mm/min, even if a tool asks for more.`}
    >
      <BoardSide />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`40 110;280 110;40 110`}
          dur={`${dur * 2}s`}
          repeatCount="indefinite"
        />
        <Bit />
      </g>
      <g stroke="#38bdf8" strokeWidth={1.5} opacity={0.6}>
        {[60, 70, 80].map((yy) => (
          <line key={yy} x1={20} x2={60} y1={yy} y2={yy}>
            <animate attributeName="x1" values="20;250;20" dur={`${dur * 2}s`} repeatCount="indefinite" />
            <animate attributeName="x2" values="45;275;45" dur={`${dur * 2}s`} repeatCount="indefinite" />
          </line>
        ))}
      </g>
      <Label x={W - 12} y={20} anchor="end" color="#7dd3fc" size={12}>
        max {m.maxFeedXY} mm/min
      </Label>
    </Scene>
  )
}

function feedZ(m: MachineProfile): ReactNode {
  const dur = clamp(1500 / Math.max(20, m.maxFeedZ), 0.8, 6)
  return (
    <Scene caption={`Up and down moves (plunging) are never faster than ${m.maxFeedZ} mm/min.`}>
      <BoardSide />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 70;160 116;160 70"
          dur={`${dur * 2}s`}
          repeatCount="indefinite"
        />
        <Bit kind="drill" />
      </g>
      <Label x={W - 12} y={20} anchor="end" color="#c4b5fd" size={12}>
        max {m.maxFeedZ} mm/min
      </Label>
    </Scene>
  )
}

function spindleRange(m: MachineProfile, which: 'min' | 'max'): ReactNode {
  const top = Math.max(30000, m.spindleMax)
  return (
    <Scene
      caption={
        which === 'min'
          ? 'The slowest speed the spindle can turn; slower requests are raised to this.'
          : 'The fastest speed the spindle can turn; faster requests are lowered to this.'
      }
    >
      <Dial cx={W / 2} cy={110} r={70} from={m.spindleMin / top} to={m.spindleMax / top} />
      <Label x={W / 2 - 78} y={128} anchor="middle" color={which === 'min' ? '#fbbf24' : '#64748b'} size={11}>
        {m.spindleMin.toLocaleString('en-US')}
      </Label>
      <Label x={W / 2 + 78} y={128} anchor="middle" color={which === 'max' ? '#fbbf24' : '#64748b'} size={11}>
        {m.spindleMax.toLocaleString('en-US')}
      </Label>
      <Label x={W / 2} y={140} anchor="middle" color="#94a3b8">
        RPM
      </Label>
    </Scene>
  )
}

function spinUp(m: MachineProfile): ReactNode {
  const t = Math.max(0.5, m.spindleSpinUpSec)
  const total = t + 2
  const k = (t / total).toFixed(3)
  return (
    <Scene
      caption={`After switching the spindle on, the machine waits ${m.spindleSpinUpSec} s for it to reach full speed before cutting.`}
    >
      <BoardSide />
      <rect x={30} y={20} width={260} height={8} rx={4} fill="#1e293b" />
      <rect x={30} y={20} height={8} rx={4} fill="#34d399">
        <animate
          attributeName="width"
          values="0;260;260"
          keyTimes={`0;${k};1`}
          dur={`${total}s`}
          repeatCount="indefinite"
        />
      </rect>
      <Label x={30} y={44} color="#6ee7b7">
        spinning up… {m.spindleSpinUpSec} s
      </Label>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 80;160 80;160 116;160 80"
          keyTimes={`0;${k};0.85;1`}
          dur={`${total}s`}
          repeatCount="indefinite"
        />
        <Bit />
      </g>
    </Scene>
  )
}

function speedControl(m: MachineProfile): ReactNode {
  return m.spindleSpeedControl ? (
    <Scene caption="The G-code sets the speed (S-word); the spindle follows it by itself.">
      <Code lines={['M3 S12000', '(spindle on at 12,000 RPM)']} hl={[0]} />
      <Dial cx={230} cy={120} r={45} from={0.1} to={0.6} label="automatic" />
    </Scene>
  ) : (
    <Scene caption="The speed is set by hand on the spindle's dial; S-words in the G-code have no effect.">
      <Code lines={['M3 S12000', '(ignored by the spindle)']} dim={[0]} />
      <Dial cx={230} cy={120} r={45} from={0.3} to={0.45} label="turn by hand" dur={5} />
    </Scene>
  )
}

function toolChange(m: MachineProfile): ReactNode {
  return m.supportsToolChange ? (
    <Scene caption="Automatic tool changer: the machine swaps bits by itself (T3 M6).">
      <Code lines={['T3 M6']} hl={[0]} x={14} y={22} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 108;160 60;160 60;160 108"
          keyTimes="0;0.3;0.7;1"
          dur="3s"
          repeatCount="indefinite"
        />
        <Bit kind="vbit" />
      </g>
      <circle cx={260} cy={60} r={22} fill="none" stroke="#475569" strokeDasharray="4 4">
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 260 60;180 260 60"
          dur="3s"
          repeatCount="indefinite"
        />
      </circle>
      <BoardSide />
    </Scene>
  ) : (
    <Scene caption="Manual change: the machine stops, you swap the bit, re-zero Z and press start.">
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 108;160 60;160 60;160 108"
          keyTimes="0;0.3;0.7;1"
          dur="4s"
          repeatCount="indefinite"
        />
        <Bit />
      </g>
      <rect x={14} y={10} width={292} height={22} rx={4} fill="#78350f" opacity={0}>
        <animate
          attributeName="opacity"
          values="0;0;0.9;0.9;0"
          keyTimes="0;0.3;0.35;0.7;1"
          dur="4s"
          repeatCount="indefinite"
        />
      </rect>
      <Label x={W / 2} y={25} anchor="middle" color="#fde68a" size={11}>
        <tspan>
          M0 (Insert tool #3, re-zero Z, press start)
          <animate
            attributeName="opacity"
            values="0;0;1;1;0"
            keyTimes="0;0.3;0.35;0.7;1"
            dur="4s"
            repeatCount="indefinite"
          />
        </tspan>
      </Label>
      <BoardSide />
    </Scene>
  )
}

function arcs(m: MachineProfile): ReactNode {
  const arc = 'M 40 110 A 90 90 0 0 1 220 110'
  const seg = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI - (i / 8) * Math.PI
    return `${130 + 90 * Math.cos(a)},${110 - 90 * Math.sin(a)}`
  }).join(' ')
  return (
    <Scene
      caption={
        m.supportsArcs
          ? 'Arcs: one G2/G3 line describes a whole curve — small files, smooth motion.'
          : 'No arcs: curves are written as many short straight lines (G1).'
      }
    >
      {m.supportsArcs ? (
        <path d={arc} fill="none" stroke="#34d399" strokeWidth={2.5} />
      ) : (
        <polyline points={seg} fill="none" stroke="#fbbf24" strokeWidth={2.5} />
      )}
      <circle r={5} fill="#f8fafc">
        <animateMotion dur="3s" repeatCount="indefinite" path={arc} />
      </circle>
      <Label x={236} y={40} color={m.supportsArcs ? '#6ee7b7' : '#fcd34d'} size={11}>
        {m.supportsArcs ? 'G2 X.. Y.. I.. J..' : 'G1 × 8 lines'}
      </Label>
    </Scene>
  )
}

function cannedCycles(m: MachineProfile): ReactNode {
  return (
    <Scene
      caption={
        m.supportsCannedCycles
          ? 'Drilling cycles: one G81 line drills every hole in the list.'
          : 'No drilling cycles: each hole is written out as down / up moves.'
      }
    >
      <Code
        lines={
          m.supportsCannedCycles
            ? ['G81 X10 Y5 Z-1.8 R1', 'X20', 'X30']
            : ['G0 X10 Y5', 'G1 Z-1.8', 'G0 Z1 …']
        }
        hl={[0, 1, 2]}
        size={10}
      />
      <BoardSide y={112} x={170} width={140} />
      {[200, 240, 280].map((x, i) => (
        <g key={x}>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`${x} 80;${x} 80;${x} 118;${x} 80;${x} 80`}
            keyTimes={`0;${(i / 3).toFixed(2)};${((i + 0.5) / 3).toFixed(2)};${((i + 1) / 3).toFixed(2)};1`}
            dur="3s"
            repeatCount="indefinite"
          />
          <Bit kind="drill" r={4} len={26} shank={6} />
        </g>
      ))}
    </Scene>
  )
}

function probing(m: MachineProfile, showCommand: boolean): ReactNode {
  return (
    <Scene
      caption={
        showCommand
          ? `Your controller probes with ${m.probeCommand}: the bit moves down until it touches the copper.`
          : 'Probing: the bit moves down slowly until it touches the copper (an electrical contact) and records the height.'
      }
    >
      <BoardSide />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 60;160 110;160 110;160 60"
          keyTimes="0;0.5;0.6;1"
          dur="3s"
          repeatCount="indefinite"
        />
        <Bit kind="vbit" />
      </g>
      <circle cx={160} cy={108} r={10} fill="#facc15" opacity={0}>
        <animate
          attributeName="opacity"
          values="0;0;0.8;0"
          keyTimes="0;0.5;0.55;0.7"
          dur="3s"
          repeatCount="indefinite"
        />
      </circle>
      <path d="M 300 112 Q 300 60 200 40" fill="none" stroke="#ef4444" strokeWidth={1.2} />
      <Label x={14} y={22} color="#fde047" size={12}>
        {showCommand ? m.probeCommand : 'touch!'}
      </Label>
    </Scene>
  )
}

function custom(m: MachineProfile, which: 'header' | 'footer'): ReactNode {
  const extra = (which === 'header' ? m.customHeader : m.customFooter).trim().split('\n').filter(Boolean)
  const mine = extra.length
    ? extra.slice(0, 2)
    : [which === 'header' ? '(your lines, e.g. G54)' : '(your lines, e.g. G28)']
  const lines =
    which === 'header'
      ? ['(Isolate traces)', 'G21', 'G90 G94 G17', ...mine, 'G0 Z5', '…']
      : ['…', 'G0 Z5', 'M5', ...mine, 'M30']
  const start = which === 'header' ? 3 : 3
  return codeFigure(
    lines,
    which === 'header'
      ? 'Your lines are added at the start of every file, after the standard setup.'
      : 'Your lines are added at the end of every file, just before the program ends.',
    mine.map((_, i) => start + i)
  )
}

export function machineFigure(key: MachineFieldKey, m: MachineProfile): ReactNode | null {
  switch (key) {
    case 'postProcessor':
      return codeFigure(
        FLAVOUR[m.postProcessor] ?? FLAVOUR.generic,
        'The start of a file in this flavour: each controller understands slightly different commands.',
        [1]
      )
    case 'fileExtension':
      return (
        <Scene
          caption={`Files are saved as board.${m.fileExtension || 'nc'} — the name your controller software looks for.`}
        >
          <g>
            <animateTransform
              attributeName="transform"
              type="translate"
              values="40 20;150 20;150 20"
              keyTimes="0;0.6;1"
              dur="3s"
              repeatCount="indefinite"
            />
            <path d="M 0 0 L 50 0 L 66 16 L 66 84 L 0 84 Z" fill="#1e293b" stroke="#38bdf8" />
            <text
              x={33}
              y={56}
              textAnchor="middle"
              fontSize={14}
              fill="#7dd3fc"
              fontFamily="ui-monospace, monospace"
            >
              .{m.fileExtension || 'nc'}
            </text>
          </g>
          <rect x={232} y={22} width={74} height={80} rx={6} fill="#0f172a" stroke="#475569" />
          <Label x={269} y={68} anchor="middle" color="#94a3b8">
            controller
          </Label>
        </Scene>
      )
    case 'outputUnits': {
      const inch = m.outputUnits === 'inch'
      return (
        <Scene
          caption={
            inch
              ? 'Coordinates are written in inches (G20): 25.4 mm is written as 1.'
              : 'Coordinates are written in millimetres (G21).'
          }
        >
          <line x1={30} x2={290} y1={90} y2={90} stroke="#94a3b8" />
          {Array.from({ length: 27 }).map((_, i) => (
            <line
              key={i}
              x1={30 + i * 10}
              x2={30 + i * 10}
              y1={90}
              y2={i % 5 === 0 ? 78 : 84}
              stroke="#94a3b8"
            />
          ))}
          <rect x={30} y={60} height={10} fill={inch ? '#fbbf24' : '#34d399'}>
            <animate
              attributeName="width"
              values="0;254;254;0"
              keyTimes="0;0.5;0.8;1"
              dur="3s"
              repeatCount="indefinite"
            />
          </rect>
          <Label x={30} y={50} color={inch ? '#fcd34d' : '#6ee7b7'} size={12}>
            {inch ? 'G20  X1.0' : 'G21  X25.4'}
          </Label>
          <Label x={30} y={110}>
            0
          </Label>
          <Label x={284} y={110} anchor="middle">
            {inch ? '1 in' : '25.4 mm'}
          </Label>
        </Scene>
      )
    }
    case 'decimals': {
      const digits = '123456'
      const d = clamp(Math.round(m.decimals), 0, 6)
      return (
        <Scene
          caption={`Numbers keep ${d} digit${d === 1 ? '' : 's'} after the decimal point; more only makes files bigger.`}
        >
          <text x={40} y={90} fontSize={30} fontFamily="ui-monospace, monospace" fill="#e2e8f0">
            X12.
            <tspan fill="#7dd3fc">{digits.slice(0, d)}</tspan>
            <tspan fill="#334155">
              {digits.slice(d)}
              <animate attributeName="opacity" values="1;0.15;1" dur="2.5s" repeatCount="indefinite" />
            </tspan>
          </text>
        </Scene>
      )
    }
    case 'lineNumbers':
      return codeFigure(
        m.lineNumbers
          ? ['N10 G21', 'N20 G90 G94 G17', 'N30 M3 S12000', 'N40 G0 Z5']
          : ['G21', 'G90 G94 G17', 'M3 S12000', 'G0 Z5'],
        m.lineNumbers
          ? 'Every line starts with N10, N20 … (only some older controllers need this).'
          : 'No line numbers: shorter files, accepted by almost every controller.'
      )
    case 'commentStyle':
      return codeFigure(
        m.commentStyle === 'semicolon'
          ? ['; Isolate traces', 'G0 Z5 ; lift']
          : ['(Isolate traces)', 'G0 Z5 (lift)'],
        'How notes inside the G-code are written. The machine ignores them; they help you read the file.',
        [0]
      )
    case 'workArea':
      return workArea(m)
    case 'maxFeedXY':
      return feedXY(m)
    case 'maxFeedZ':
      return feedZ(m)
    case 'spindleMin':
      return spindleRange(m, 'min')
    case 'spindleMax':
      return spindleRange(m, 'max')
    case 'spindleSpinUpSec':
      return spinUp(m)
    case 'spindleSpeedControl':
      return speedControl(m)
    case 'safeZ':
    case 'travelZ':
    case 'toolChangeZ':
      return (
        <div className="overflow-hidden rounded-md border border-slate-800">
          <HeightsIllustration
            safeZ={m.safeZ}
            travelZ={m.travelZ}
            toolChangeZ={m.toolChangeZ}
            highlight={key === 'safeZ' ? 'safe' : key === 'travelZ' ? 'travel' : 'change'}
          />
        </div>
      )
    case 'supportsToolChange':
      return toolChange(m)
    case 'supportsArcs':
      return arcs(m)
    case 'supportsCannedCycles':
      return cannedCycles(m)
    case 'supportsProbing':
      return probing(m, false)
    case 'probeCommand':
      return probing(m, true)
    case 'customHeader':
      return custom(m, 'header')
    case 'customFooter':
      return custom(m, 'footer')
    default:
      return null
  }
}
