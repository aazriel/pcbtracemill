/**
 * Board setup guide: how to prepare and hold the copper sheet so probing and milling give an even
 * cut depth (lessons from real test runs, D-036). One animated picture per step, paged with
 * Back / Next. Shown as the "Board setup" help topic; the probe dialog and the auto-level section
 * open it.
 */
import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Bit, Scene, W } from '@renderer/components/illustrations/kit'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

const COPPER = '#c47a3a'
const COPPER_TOP = '#d08a4a'
const FR4 = '#3f5a2a'
const WOOD = '#6b4f35'
const TAPE = '#e2e8f0'
const MASKING = '#e7d7a1'
const GLUE = '#fde047'
const OK = '#22c55e'
const BAD = '#f43f5e'
const DUR = '6s'

/** keyTimes / values helper: repeatCount indefinite with the guide's loop length. */
function Anim(props: React.SVGProps<SVGAnimateElement>): React.JSX.Element {
  return <animate dur={DUR} repeatCount="indefinite" {...props} />
}
function Move({
  values,
  keyTimes,
  type = 'translate'
}: {
  values: string
  keyTimes: string
  type?: 'translate' | 'rotate'
}): React.JSX.Element {
  return (
    <animateTransform
      attributeName="transform"
      type={type}
      values={values}
      keyTimes={keyTimes}
      dur={DUR}
      repeatCount="indefinite"
    />
  )
}

function Txt({
  x,
  y,
  children,
  fill = '#cbd5e1',
  size = 9,
  anchor = 'middle'
}: {
  x: number
  y: number
  children: ReactNode
  fill?: string
  size?: number
  anchor?: 'start' | 'middle' | 'end'
}): React.JSX.Element {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontFamily="system-ui, sans-serif">
      {children}
    </text>
  )
}

/** Spoilboard (machine table) in side view. */
function Table({ y = 122 }: { y?: number }): React.JSX.Element {
  return <rect x={0} y={y} width={W} height={150 - y} fill={WOOD} />
}

/** Copper-clad sheet in side view from x0 to x1, top at y. */
function Sheet({ x0, x1, y }: { x0: number; x1: number; y: number }): React.JSX.Element {
  return (
    <g>
      <rect x={x0} y={y + 2.5} width={x1 - x0} height={8} fill={FR4} />
      <rect x={x0} y={y} width={x1 - x0} height={2.5} fill={COPPER_TOP} />
    </g>
  )
}

// ───────────────────────────────────────── the pictures

/** 1. The board slides from the sheet corner into the flat middle. */
function CentreFigure(): React.JSX.Element {
  return (
    <Scene>
      <rect x={0} y={0} width={W} height={150} fill={WOOD} opacity={0.35} />
      <clipPath id="tm-guide-sheet">
        <rect x={40} y={14} width={240} height={122} rx={2} />
      </clipPath>
      <rect x={40} y={14} width={240} height={122} rx={2} fill={COPPER} />
      {/* bent corners */}
      {[
        [40, 14],
        [280, 14],
        [40, 136],
        [280, 136]
      ].map(([x, y]) => (
        <circle
          key={`${x}${y}`}
          cx={x}
          cy={y}
          r={30}
          fill="#7c2d12"
          opacity={0.45}
          clipPath="url(#tm-guide-sheet)"
        />
      ))}
      <ellipse cx={160} cy={75} rx={70} ry={38} fill="none" stroke={OK} strokeDasharray="4 3">
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.55;0.7;1" />
      </ellipse>
      <Txt x={160} y={31} fill="#bbf7d0">
        flattest part
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.55;0.7;1" />
      </Txt>
      <Txt x={62} y={146} size={8} fill="#fecaca">
        bent corners
      </Txt>
      <g>
        <rect
          x={46}
          y={80}
          width={90}
          height={50}
          fill="#1e293b"
          opacity={0.25}
          stroke="#f8fafc"
          strokeWidth={1.4}
        />
        <Txt x={91} y={109} fill="#f8fafc">
          board
        </Txt>
        <Move values="0 0;0 0;69 -25;69 -25" keyTimes="0;0.2;0.55;1" />
      </g>
    </Scene>
  )
}

/** 2. Solder a blob on the sheet corner, outside the board, and clip the probe wire to it. */
function SolderFigure(): React.JSX.Element {
  return (
    <Scene>
      <rect x={0} y={0} width={W} height={150} fill={WOOD} opacity={0.35} />
      <rect x={20} y={10} width={300} height={130} fill={COPPER} />
      <rect x={110} y={10} width={210} height={95} fill="none" stroke="#f8fafc" strokeDasharray="5 3" />
      <Txt x={215} y={60} fill="#f8fafc">
        board outline
      </Txt>
      {/* solder blob */}
      <circle cx={55} cy={115} r={0} fill="#cbd5e1" stroke="#94a3b8">
        <Anim attributeName="r" values="0;0;7;7" keyTimes="0;0.3;0.42;1" />
      </circle>
      {/* soldering iron */}
      <g>
        <path d="M0 0 L40 -26 L46 -18 L6 6 Z" fill="#94a3b8" />
        <path d="M40 -26 L95 -62 L104 -50 L46 -18 Z" fill="#1d4ed8" />
        <Move values="90 20;0 0;0 0;120 30;120 30" keyTimes="0;0.2;0.42;0.55;1" />
      </g>
      {/* clip and wire */}
      <g>
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.6;0.66;1" />
        <path d="M49 110 L61 110 L61 120 L49 120 Z" fill={BAD} />
        <path d="M61 115 C 90 115, 80 140, 130 145" stroke={BAD} strokeWidth={2} fill="none" />
        <Txt x={160} y={132} fill="#fecaca" size={8} anchor="start">
          probe wire
        </Txt>
      </g>
      <Txt x={56} y={97} fill="#f8fafc" size={8}>
        solder point
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.42;0.5;1" />
      </Txt>
    </Scene>
  )
}

/** 3. Tape strips on the table, the sheet goes down onto them, a roller presses it flat. */
function TapeFigure(): React.JSX.Element {
  const drops = [40, 85, 130, 175, 220, 265]
  return (
    <Scene>
      <Table />
      {/* masking tape on the table */}
      <rect x={10} y={119} width={300} height={3} fill={MASKING}>
        <Anim attributeName="width" values="0;0;300;300" keyTimes="0;0.03;0.15;1" />
      </rect>
      {/* glue drops on it */}
      {drops.map((x, i) => (
        <circle key={x} cx={x} cy={118} r={0} fill={GLUE}>
          <Anim
            attributeName="r"
            values="0;0;2.6;2.6;0"
            keyTimes={`0;${(0.18 + i * 0.03).toFixed(2)};${(0.21 + i * 0.03).toFixed(2)};0.53;0.55`}
          />
        </circle>
      ))}
      <g>
        <Sheet x0={10} x1={310} y={104.5} />
        {/* masking tape under the sheet */}
        <rect x={10} y={115} width={300} height={3} fill={MASKING} />
        <Move values="0 -60;0 -60;0 1;0 1" keyTimes="0;0.4;0.55;1" />
      </g>
      <Txt x={60} y={140} size={8} fill="#0f172a" anchor="start">
        masking tape + glue + masking tape
      </Txt>
      {/* roller */}
      <g>
        <Anim attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.58;0.6;0.95;1" />
        <circle cx={0} cy={95} r={10} fill="#334155" stroke="#94a3b8" strokeWidth={1.5} />
        <path d="M0 95 L-18 50" stroke="#94a3b8" strokeWidth={3} />
        <Move values="20 0;20 0;300 0;300 0" keyTimes="0;0.6;0.95;1" />
      </g>
      {[16, 304].map((x) => (
        <path key={x} d={`M${x} 70 l0 22 m-5 -6 l5 6 l5 -6`} stroke={OK} strokeWidth={2} fill="none">
          <Anim attributeName="opacity" values="0;0;1;0;1;0" keyTimes="0;0.6;0.7;0.8;0.9;1" />
        </path>
      ))}
      <Txt x={160} y={30}>
        tape on both, glue between, press together – corners hard
      </Txt>
    </Scene>
  )
}

/** 4. In the first minutes the tape lets go (a corner rises), then it settles: probe after ~30 min. */
function WaitFigure(): React.JSX.Element {
  return (
    <Scene>
      <Table />
      {[40, 110, 180, 250].map((x) => (
        <rect key={x} x={x - 22} y={118} width={44} height={4} fill={TAPE} />
      ))}
      <Sheet x0={10} x1={200} y={107.5} />
      <g>
        <Sheet x0={199} x1={310} y={107.5} />
        <Move type="rotate" values="0 200 118;-4 200 118;-5 200 118;-5 200 118" keyTimes="0;0.3;0.55;1" />
      </g>
      {/* clock */}
      <circle cx={262} cy={42} r={20} fill="#0f172a" stroke="#94a3b8" strokeWidth={1.5} />
      <line x1={262} y1={42} x2={262} y2={27} stroke="#f8fafc" strokeWidth={2}>
        <Move type="rotate" values="0 262 42;360 262 42;360 262 42" keyTimes="0;0.6;1" />
      </line>
      <Txt x={262} y={75} size={8}>
        ~30 min
      </Txt>
      <Txt x={110} y={36} fill="#fecaca">
        most of the lifting happens early…
        <Anim attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.1;0.55;0.6;1" />
      </Txt>
      <Txt x={110} y={36} fill="#bbf7d0">
        …then it settles: probe now
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.6;0.65;1" />
      </Txt>
      {/* probe bit coming down after the wait */}
      <g>
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.62;0.66;1" />
        <g>
          <Bit kind="flat" r={4} len={30} />
          <Move values="110 60;110 60;110 107;110 107" keyTimes="0;0.66;0.85;1" />
        </g>
      </g>
    </Scene>
  )
}

/** 5. The board moves after probing: the bit follows the old map and digs in where the board rose. */
function RiskFigure(): React.JSX.Element {
  return (
    <Scene>
      <Table />
      <Sheet x0={10} x1={190} y={107.5} />
      <g>
        <Sheet x0={189} x1={310} y={107.5} />
        <Move type="rotate" values="0 190 118;0 190 118;-4 190 118;-4 190 118" keyTimes="0;0.15;0.35;1" />
      </g>
      <line x1={10} y1={107.5} x2={310} y2={107.5} stroke="#38bdf8" strokeDasharray="4 3" />
      <Txt x={60} y={100} size={8} fill="#7dd3fc">
        height map (probed)
      </Txt>
      <g>
        <Bit kind="vbit" r={5} len={34} />
        <Move values="40 108.5;40 108.5;300 108.5;300 108.5" keyTimes="0;0.35;0.9;1" />
      </g>
      <path d="M200 108 L300 101 L300 108.5 Z" fill={BAD} opacity={0}>
        <Anim attributeName="opacity" values="0;0;0.8;0.8" keyTimes="0;0.6;0.7;1" />
      </path>
      <Txt x={250} y={80} fill="#fecaca">
        board rose: cut too deep
        <Anim attributeName="opacity" values="0;0;1;1" keyTimes="0;0.6;0.7;1" />
      </Txt>
      <Txt x={160} y={30}>
        the map only fits while the board stays where it was probed
      </Txt>
    </Scene>
  )
}

/** 6. Slow: the bit touches gently. Fast: the board is pushed down and the tip snaps. */
function SlowFigure(): React.JSX.Element {
  return (
    <Scene>
      <Table />
      <Sheet x0={10} x1={150} y={107.5} />
      <g>
        <Sheet x0={170} x1={310} y={107.5} />
        <Move values="0 0;0 0;0 3;0 0;0 0" keyTimes="0;0.25;0.3;0.4;1" />
      </g>
      <line x1={160} y1={20} x2={160} y2={120} stroke="#334155" />
      {/* slow */}
      <g>
        <Bit kind="vbit" r={4} len={32} />
        <Move values="80 50;80 107.5;80 107.5;80 50" keyTimes="0;0.7;0.85;1" />
      </g>
      <circle cx={80} cy={107} r={0} fill={OK}>
        <Anim attributeName="r" values="0;0;5;0;0" keyTimes="0;0.7;0.75;0.85;1" />
      </circle>
      <Txt x={80} y={30} fill="#bbf7d0">
        slow: gentle touch ✓
      </Txt>
      {/* fast */}
      <g>
        <Bit kind="vbit" r={4} len={32} />
        <Move values="240 50;240 111;240 111;240 50;240 50" keyTimes="0;0.25;0.45;0.6;1" />
      </g>
      <path d="M236 116 l8 -6 m-8 0 l8 6" stroke={BAD} strokeWidth={2.5}>
        <Anim attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.25;0.3;0.6;1" />
      </path>
      <Txt x={240} y={30} fill="#fecaca">
        fast: pushes the board, breaks the tip ✗
      </Txt>
    </Scene>
  )
}

/** One bit profile tip-down at (0,0): tapered end mill, pyramid or V-bit (0.1 mm tip). */
function BitProfile({ kind }: { kind: 'tapered' | 'pyramid' | 'vbit' }): React.JSX.Element {
  return (
    <g>
      <rect x={-8} y={-96} width={16} height={36} fill="#94a3b8" />
      {kind === 'tapered' && (
        <>
          <path d="M-8 -60 L8 -60 L1 0 L-1 0 Z" fill="#cbd5e1" />
          {[-52, -40, -28, -16].map((y) => (
            <path
              key={y}
              d={`M${-6 - y / 10} ${y} L${5 + y / 12} ${y - 7}`}
              stroke="#64748b"
              strokeWidth={1.2}
            >
              <Anim attributeName="opacity" values="1;0.3;1" keyTimes="0;0.5;1" />
            </path>
          ))}
        </>
      )}
      {kind === 'pyramid' && (
        <>
          <path d="M-8 -60 L8 -60 L0 0 Z" fill="#cbd5e1" />
          <path d="M-3 -60 L0 0 M3 -60 L0 0" stroke="#64748b" strokeWidth={1} />
        </>
      )}
      {kind === 'vbit' && (
        <>
          <path d="M-8 -60 L8 -60 L0 0 Z" fill="#cbd5e1" />
          <path d="M0 -60 L8 -60 L0 0 Z" fill="#64748b" />
        </>
      )}
    </g>
  )
}

/** 7. The three bits that work, best first. */
function BitsFigure(): React.JSX.Element {
  const bits = [
    { kind: 'tapered', name: 'Tapered end mill', x: 60 },
    { kind: 'pyramid', name: 'Pyramid bit', x: 160 },
    { kind: 'vbit', name: 'V-bit', x: 260 }
  ] as const
  return (
    <Scene>
      {bits.map((b, i) => (
        <g key={b.kind}>
          <g transform={`translate(${b.x} 128)`}>
            <BitProfile kind={b.kind} />
          </g>
          <circle cx={b.x + 26} cy={40} r={10} fill={i === 0 ? OK : i === 1 ? '#38bdf8' : '#64748b'}>
            <Anim
              attributeName="r"
              values="10;10;12;10;10"
              keyTimes={`0;${(i * 0.3).toFixed(2)};${(i * 0.3 + 0.1).toFixed(2)};${(i * 0.3 + 0.2).toFixed(2)};1`}
            />
          </circle>
          <Txt x={b.x + 26} y={44} fill="#0f172a" size={11}>
            {i + 1}
          </Txt>
          <Txt x={b.x} y={144} size={9}>
            {b.name}
          </Txt>
        </g>
      ))}
    </Scene>
  )
}

// ───────────────────────────────────────── the pages

interface GuidePage {
  title: string
  figure: () => React.JSX.Element
  points: ReactNode[]
}

export const SETUP_GUIDE: GuidePage[] = [
  {
    title: 'Put the board in the middle of the sheet',
    figure: CentreFigure,
    points: [
      'The middle of a copper sheet is the flattest part and moves least. The edges and corners are where a sheet is bent and where tape lets go first.',
      'PCB TraceMill centres the board by default. When you type your real sheet size in Material, it stays centred.'
    ]
  },
  {
    title: 'Solder a ground point on a corner',
    figure: SolderFigure,
    points: [
      <>
        Solder a small blob (or a short wire) on a <b>corner of the sheet, outside the board</b>, and clip the
        probe’s ground wire to it.
      </>,
      'A soldered point never slips like a clip on bare copper, and the outer copper stays connected after isolation, so later touches still work.'
    ]
  },
  {
    title: 'Tape it down',
    figure: TapeFigure,
    points: [
      <>
        Put <b>masking tape</b> on the back of the sheet and on the machine table, add glue (super glue) on
        one of them, and press the two together – firmly, especially the corners. It holds best and peels off
        cleanly afterwards.
      </>,
      'Cover the whole back, not only the edges, so the middle cannot bounce under the bit. Double-sided tape works too, but holds less well.'
    ]
  },
  {
    title: 'Wait about 30 minutes, then probe',
    figure: WaitFigure,
    points: [
      'Fresh tape slowly lets go: in our tests a corner rose 0.7 mm in 45 minutes. Most of that happens in the first half hour.',
      'Let it settle for about 30 minutes, then probe – the height map catches the board as it now stays.'
    ]
  },
  {
    title: 'The risk: the board moves after probing',
    figure: RiskFigure,
    points: [
      'The G-code follows the probed heights. If the board rises or sinks afterwards, the bit digs too deep there, or barely scratches the copper.',
      <>
        So start milling <b>right after</b> probing, and don’t press, re-tape or move the board in between.
      </>
    ]
  },
  {
    title: 'Go slowly – use the speeds PCB TraceMill sets',
    figure: SlowFigure,
    points: [
      <>
        Use the <b>speeds PCB TraceMill sets</b> – for probing <b>and</b> for cutting. A fast plunge or a fast
        cut pushes the board out of place, or snaps a 0.1 mm tip.
      </>,
      'Watch the first points: if the bit doesn’t go down to the copper, the controller missed that touch – stop and run the probe program again.'
    ]
  },
  {
    title: 'Pick the right bit',
    figure: BitsFigure,
    points: [
      <>
        Best results, in order: <b>1. tapered end mill</b>, <b>2. pyramid bit</b>, <b>3. V-bit</b>.
      </>,
      'All with a 0.1 mm tip and 10° or 20°. Wider angles work too – they just cut wider grooves as the depth grows.'
    ]
  }
]

/** The guide, paged: picture, short points, Back / Next. */
export function SetupGuide({ className }: { className?: string }): React.JSX.Element {
  const [i, setI] = useState(0)
  const page = SETUP_GUIDE[i]
  const F = page.figure
  const last = i === SETUP_GUIDE.length - 1
  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="setup-guide">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-600/30 text-xs font-bold text-sky-100">
          {i + 1}
        </span>
        <h3 className="flex-1 text-sm font-semibold text-slate-100" data-testid="setup-guide-title">
          {page.title}
        </h3>
        <span className="text-[11px] text-slate-500">
          {i + 1} / {SETUP_GUIDE.length}
        </span>
      </div>
      {/* key: restart the animation on every page */}
      <div key={i} className="mx-auto w-full max-w-[560px]">
        <F />
      </div>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-slate-300">
        {page.points.map((p, k) => (
          <li key={k}>{p}</li>
        ))}
      </ul>
      <div className="mt-1 flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex flex-1 justify-center gap-1.5">
          {SETUP_GUIDE.map((p, k) => (
            <button
              key={p.title}
              type="button"
              aria-label={`Step ${k + 1}: ${p.title}`}
              title={p.title}
              onClick={() => setI(k)}
              className={cn(
                'size-2 rounded-full',
                k === i ? 'bg-sky-400' : 'bg-slate-600 hover:bg-slate-400'
              )}
            />
          ))}
        </div>
        <Button
          size="sm"
          variant={last ? 'secondary' : 'default'}
          disabled={last}
          data-testid="setup-guide-next"
          onClick={() => setI(i + 1)}
        >
          Next <ArrowRight />
        </Button>
      </div>
    </div>
  )
}
