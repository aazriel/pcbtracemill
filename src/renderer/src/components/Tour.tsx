/**
 * First-run tour: a short full-screen walkthrough of the four stages. Shown once on the first start
 * (Help → Take the tour shows it again).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const DONE_KEY = 'tourDone'

export const useTour = create<{ open: boolean }>()(() => ({ open: false }))

export function openTour(): void {
  useTour.setState({ open: true })
}

/** Opens the tour on the very first start. */
export async function maybeShowTour(): Promise<boolean> {
  const api = window.tracemill
  if (!api || api.noStartupPrompts) return false
  const done = await api.settingsGet<boolean>(DONE_KEY, false)
  if (!done) openTour()
  return !done
}

// ───────────────────────────────────────── illustrations

const C = {
  board: '#14532d',
  fr4: '#3f6212',
  copper: '#d97745',
  copperHi: '#f0a070',
  groove: '#0b1220',
  sky: '#38bdf8',
  bit: '#cbd5e1'
}

function Stage({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 360 200" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="tour-copper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={C.copperHi} />
          <stop offset="100%" stopColor={C.copper} />
        </linearGradient>
      </defs>
      {children}
    </svg>
  )
}

const TRACE = 'M 110 120 L 150 120 L 175 90 L 250 90'

function WelcomeArt(): React.JSX.Element {
  return (
    <Stage>
      <rect x="80" y="45" width="200" height="120" rx="10" fill="url(#tour-copper)" />
      {/* the groove appears behind the bit */}
      <path
        d={TRACE}
        fill="none"
        stroke={C.groove}
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="1;0;0"
          keyTimes="0;0.7;1"
          dur="4s"
          repeatCount="indefinite"
        />
      </path>
      <path
        d={TRACE}
        fill="none"
        stroke={C.copperHi}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="110" cy="120" r="7" fill={C.copperHi} />
      <circle cx="250" cy="90" r="7" fill={C.copperHi} />
      <g>
        <animateMotion
          path={TRACE}
          keyPoints="0;1;1"
          keyTimes="0;0.7;1"
          calcMode="linear"
          dur="4s"
          repeatCount="indefinite"
        />
        <rect x="-5" y="-62" width="10" height="44" rx="2" fill={C.bit} />
        <path d="M -5 -18 L 5 -18 L 0 0 Z" fill="#94a3b8" />
      </g>
    </Stage>
  )
}

function BoardArt(): React.JSX.Element {
  const files = ['F_Cu.gbr', 'B_Cu.gbr', 'Edge.gbr', 'PTH.drl']
  return (
    <Stage>
      {files.map((f, i) => (
        <g key={f}>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`${30 + i * 8} ${20 + i * 34};${30 + i * 8} ${20 + i * 34};190 ${60 + i * 6};190 ${60 + i * 6}`}
            keyTimes={`0;${(0.1 + i * 0.12).toFixed(2)};${(0.3 + i * 0.12).toFixed(2)};1`}
            dur="5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="1;1;0;0"
            keyTimes={`0;${(0.25 + i * 0.12).toFixed(2)};${(0.32 + i * 0.12).toFixed(2)};1`}
            dur="5s"
            repeatCount="indefinite"
          />
          <rect width="96" height="26" rx="6" fill="#1e293b" stroke="#334155" />
          <rect
            x="8"
            y="7"
            width="12"
            height="12"
            rx="2"
            fill={i === 3 ? '#a78bfa' : i === 2 ? '#facc15' : C.copper}
          />
          <text x="26" y="17" fontSize="10" fill="#e2e8f0" fontFamily="ui-sans-serif, system-ui">
            {f}
          </text>
        </g>
      ))}
      <g>
        <animate
          attributeName="opacity"
          values="0;0;1;1"
          keyTimes="0;0.7;0.8;1"
          dur="5s"
          repeatCount="indefinite"
        />
        <rect x="200" y="50" width="130" height="90" rx="8" fill={C.board} stroke="#facc15" strokeWidth="2" />
        <path d="M 220 110 L 250 110 L 265 80 L 310 80" stroke={C.copperHi} strokeWidth="4" fill="none" />
        <circle cx="220" cy="110" r="5" fill={C.copperHi} />
        <circle cx="310" cy="80" r="5" fill={C.copperHi} />
        <circle cx="310" cy="80" r="2" fill={C.groove} />
        <circle cx="220" cy="110" r="2" fill={C.groove} />
      </g>
      <rect
        x="200"
        y="50"
        width="130"
        height="90"
        rx="8"
        fill="none"
        stroke="#475569"
        strokeDasharray="4 4"
      />
    </Stage>
  )
}

function PlanArt(): React.JSX.Element {
  const steps = [
    { t: 'Isolate traces', c: '#f472b6' },
    { t: 'Drill holes', c: '#a3e635' },
    { t: 'Cut out board', c: '#facc15' }
  ]
  return (
    <Stage>
      {steps.map((s, i) => (
        <g key={s.t} transform={`translate(90 ${36 + i * 46})`}>
          <animate
            attributeName="opacity"
            values="0;0;1;1"
            keyTimes={`0;${(0.1 + i * 0.18).toFixed(2)};${(0.2 + i * 0.18).toFixed(2)};1`}
            dur="4.5s"
            repeatCount="indefinite"
          />
          <rect width="180" height="36" rx="9" fill="#0f172a" stroke="#334155" />
          <rect x="0" y="6" width="4" height="24" rx="2" fill={s.c} />
          <circle cx="22" cy="18" r="9" fill="#1e293b" />
          <text x="22" y="22" fontSize="10" fill="#e2e8f0" textAnchor="middle" fontWeight="700">
            {i + 1}
          </text>
          <text
            x="40"
            y="22"
            fontSize="12"
            fill="#f1f5f9"
            fontFamily="ui-sans-serif, system-ui"
            fontWeight="600"
          >
            {s.t}
          </text>
          <circle cx="160" cy="18" r="8" fill="none" stroke="#22c55e" strokeWidth="2" />
          <path d="M 156 18 L 159 21 L 164 15" stroke="#22c55e" strokeWidth="2" fill="none" />
        </g>
      ))}
    </Stage>
  )
}

function SimArt(): React.JSX.Element {
  return (
    <Stage>
      <g transform="translate(180 108) skewX(-20) scale(1 0.62)">
        <rect x="-110" y="-80" width="220" height="160" rx="8" fill={C.fr4} />
        <rect x="-110" y="-80" width="220" height="160" rx="8" fill="url(#tour-copper)" />
        <path
          d="M -80 30 L -20 30 L 10 -20 L 80 -20"
          fill="none"
          stroke={C.fr4}
          strokeWidth="16"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
        >
          <animate
            attributeName="stroke-dashoffset"
            values="1;0;0"
            keyTimes="0;0.75;1"
            dur="4s"
            repeatCount="indefinite"
          />
        </path>
        <path
          d="M -80 30 L -20 30 L 10 -20 L 80 -20"
          fill="none"
          stroke={C.copperHi}
          strokeWidth="5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M -80 30 L -20 30 L 10 -20 L 80 -20"
          fill="none"
          stroke={C.sky}
          strokeWidth="1.5"
          strokeDasharray="3 3"
          opacity="0.9"
        />
      </g>
      <g>
        <animateMotion
          path="M 93.2 126.6 L 153.2 126.6 L 194.5 95.6 L 264.5 95.6"
          keyPoints="0;1;1"
          keyTimes="0;0.75;1"
          calcMode="linear"
          dur="4s"
          repeatCount="indefinite"
        />
        <rect x="-5" y="-60" width="10" height="42" rx="2" fill={C.bit} />
        <path d="M -5 -18 L 5 -18 L 0 0 Z" fill="#94a3b8" />
      </g>
      <g transform="translate(270 40)">
        <rect width="66" height="22" rx="11" fill="#0f172a" stroke="#334155" />
        <circle cx="13" cy="11" r="5" fill="#38bdf8">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
        <text x="24" y="15" fontSize="10" fill="#e2e8f0" fontFamily="ui-sans-serif, system-ui">
          playing
        </text>
      </g>
    </Stage>
  )
}

function ExportArt(): React.JSX.Element {
  return (
    <Stage>
      <g transform="translate(70 40)">
        <rect width="92" height="116" rx="10" fill="#0f172a" stroke="#334155" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x="14"
            y={18 + i * 15}
            width={[50, 64, 40, 58, 46, 30][i]}
            height="6"
            rx="3"
            fill={['#38bdf8', '#a3e635', '#f472b6', '#a3e635', '#facc15', '#94a3b8'][i]}
            opacity="0.85"
          />
        ))}
        <text
          x="46"
          y="108"
          fontSize="10"
          fill="#94a3b8"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
        >
          board.tap
        </text>
      </g>
      <path d="M 170 98 L 205 98" stroke="#475569" strokeWidth="3" strokeDasharray="5 5">
        <animate attributeName="stroke-dashoffset" values="20;0" dur="0.8s" repeatCount="indefinite" />
      </path>
      <path d="M 203 90 L 213 98 L 203 106" fill="none" stroke="#475569" strokeWidth="3" />
      {/* the machine */}
      <g transform="translate(222 46)">
        <rect x="0" y="86" width="100" height="16" rx="3" fill="#334155" />
        <rect x="6" y="0" width="8" height="90" rx="2" fill="#475569" />
        <rect x="86" y="0" width="8" height="90" rx="2" fill="#475569" />
        <rect x="0" y="6" width="100" height="10" rx="3" fill="#64748b" />
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="18 0;66 0;18 0"
            dur="3s"
            repeatCount="indefinite"
          />
          <rect x="0" y="14" width="18" height="30" rx="3" fill="#94a3b8" />
          <rect x="7" y="44" width="4" height="22" fill={C.bit}>
            <animate attributeName="height" values="18;26;18" dur="0.75s" repeatCount="indefinite" />
          </rect>
        </g>
        <rect x="14" y="74" width="72" height="12" rx="2" fill="url(#tour-copper)" />
      </g>
    </Stage>
  )
}

// ───────────────────────────────────────── pages

interface Page {
  eyebrow: string
  title: string
  body: string
  art: () => React.JSX.Element
  tint: string
}

const PAGES: Page[] = [
  {
    eyebrow: 'Welcome',
    title: 'Your PCB, milled at home.',
    body: 'TraceMill turns the fabrication files of your board into G-code for your CNC router. No CAM experience needed: it picks sensible settings and explains every one of them.',
    art: WelcomeArt,
    tint: 'from-sky-500/25'
  },
  {
    eyebrow: 'Step 1 · Board',
    title: 'Bring in your board.',
    body: 'Drop the Gerber and drill files from KiCad, Altium, Eagle or EasyEDA (a ZIP or a whole folder is fine). TraceMill recognises each layer and shows the board.',
    art: BoardArt,
    tint: 'from-amber-500/25'
  },
  {
    eyebrow: 'Step 2 · Manufacture',
    title: 'Let the Recipe plan the job.',
    body: 'One click creates the steps: isolate the traces, drill the holes, cut the board out, with the right bit for each. Every setting has a (?) with a small animation that shows what it does.',
    art: PlanArt,
    tint: 'from-pink-500/25'
  },
  {
    eyebrow: 'Step 3 · Simulation',
    title: 'See it before you cut.',
    body: 'Watch the bit remove copper in 3D, and compare the result with your design. Problems show up here, not on your last piece of copper-clad board.',
    art: SimArt,
    tint: 'from-emerald-500/25'
  },
  {
    eyebrow: 'Step 4 · Export',
    title: 'Send it to the machine.',
    body: 'Save the G-code for your controller (Mach3, GRBL, LinuxCNC…) and follow the short checklist: clamp the board, set zero, change bits when asked.',
    art: ExportArt,
    tint: 'from-violet-500/25'
  }
]

export function Tour(): React.JSX.Element | null {
  const open = useTour((s) => s.open)
  const [i, setI] = useState(0)
  const last = i === PAGES.length - 1

  const close = (): void => {
    useTour.setState({ open: false })
    setI(0)
    void window.tracemill?.settingsSet(DONE_KEY, true)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') setI((v) => Math.min(PAGES.length - 1, v + 1))
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-xl"
      data-testid="tour"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour"
    >
      <div className="relative flex h-[min(640px,92vh)] w-[min(880px,94vw)] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)]">
        <button
          onClick={close}
          className="absolute right-4 top-4 z-10 rounded-full p-2 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
          aria-label="Close the tour"
          data-testid="tour-close"
        >
          <X className="size-5" />
        </button>
        {/* slides */}
        <div className="relative min-h-0 flex-1">
          {PAGES.map((p, k) => {
            const Art = p.art
            return (
              <section
                key={p.title}
                aria-hidden={k !== i}
                className={cn(
                  'absolute inset-0 flex flex-col items-center px-10 pt-8 text-center transition-all duration-500 ease-out',
                  k === i
                    ? 'translate-x-0 opacity-100'
                    : k < i
                      ? 'pointer-events-none -translate-x-10 opacity-0'
                      : 'pointer-events-none translate-x-10 opacity-0'
                )}
              >
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-gradient-to-b to-transparent',
                    p.tint
                  )}
                />
                <div className="relative h-[52%] w-full max-w-[640px]">{k === i && <Art />}</div>
                <div className="relative mt-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-sky-400">
                  {p.eyebrow}
                </div>
                <h2 className="relative mt-2 text-[34px] font-semibold leading-tight tracking-tight text-white">
                  {p.title}
                </h2>
                <p className="relative mt-3 max-w-[560px] text-[15px] leading-relaxed text-slate-400">
                  {p.body}
                </p>
              </section>
            )
          })}
        </div>
        {/* controls */}
        <div className="flex items-center justify-between px-8 pb-7 pt-3">
          <div className="w-32">
            {i > 0 ? (
              <button
                onClick={() => setI(i - 1)}
                className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
            ) : (
              <button
                onClick={close}
                className="rounded-full px-3 py-2 text-sm text-slate-500 hover:bg-white/5 hover:text-slate-300"
                data-testid="tour-skip"
              >
                Skip tour
              </button>
            )}
          </div>
          <div className="flex items-center gap-2" role="tablist">
            {PAGES.map((p, k) => (
              <button
                key={p.title}
                onClick={() => setI(k)}
                role="tab"
                aria-selected={k === i}
                aria-label={`Page ${k + 1}`}
                className={cn(
                  'h-2 rounded-full transition-all duration-300',
                  k === i ? 'w-6 bg-white' : 'w-2 bg-white/25 hover:bg-white/50'
                )}
              />
            ))}
          </div>
          <div className="flex w-32 justify-end">
            <button
              onClick={() => (last ? close() : setI(i + 1))}
              className="flex items-center gap-1.5 rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 outline-none transition-colors hover:bg-sky-400 focus-visible:ring-2 focus-visible:ring-white/60"
              data-testid="tour-next"
              autoFocus
            >
              {last ? 'Get started' : 'Continue'}
              {!last && <ArrowRight className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
