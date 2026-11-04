import { Files, Layers, FileCode2 } from 'lucide-react'
import type { ExportGrouping } from '@core/model/types'
import { HELP } from '@core/help'
import { HelpTip } from '@renderer/components/ui/help'
import { cn } from '@renderer/lib/utils'

/** Illustration data: four example steps and the bit each one uses. */
const DEMO_STEPS = [
  { label: 'Drill', tool: 0 },
  { label: 'Isolate', tool: 1 },
  { label: 'Clear', tool: 1 },
  { label: 'Cut out', tool: 2 }
]
const TOOL_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa']

function groupsFor(g: ExportGrouping): number[][] {
  if (g === 'combined') return [[0, 1, 2, 3]]
  if (g === 'per-tool') return [[0], [1, 2], [3]]
  return [[0], [1], [2], [3]]
}

/** Tiny picture: coloured dots = steps (colour = bit), page glyphs = output files. */
function GroupingIllustration({
  grouping,
  active
}: {
  grouping: ExportGrouping
  active: boolean
}): React.JSX.Element {
  const groups = groupsFor(grouping)
  const fileW = 22
  const gap = 6
  return (
    <svg
      width={4 * (fileW + gap)}
      height={34}
      viewBox={`0 0 ${4 * (fileW + gap)} 34`}
      aria-hidden
      className="shrink-0"
    >
      {groups.map((g, gi) => {
        const w = grouping === 'combined' ? 4 * fileW + 3 * gap : g.length * fileW + (g.length - 1) * gap
        const x = groups.slice(0, gi).reduce((a, gg) => a + gg.length * (fileW + gap), 0)
        return (
          <g key={gi} transform={`translate(${x + 0.5},1.5)`}>
            <path
              d={`M0 0 H${w - 7} L${w} 7 V30 H0 Z`}
              fill={active ? 'rgba(14,165,233,0.12)' : 'rgba(148,163,184,0.06)'}
              stroke={active ? '#38bdf8' : '#475569'}
              strokeWidth={1}
            />
            <path d={`M${w - 7} 0 V7 H${w}`} fill="none" stroke={active ? '#38bdf8' : '#475569'} />
            {g.map((si, k) => {
              const cx = (grouping === 'combined' ? (w / 4) * k + w / 8 : k * (fileW + gap) + fileW / 2) + 0
              return (
                <circle
                  key={si}
                  cx={cx}
                  cy={18}
                  r={4.5}
                  fill={TOOL_COLORS[DEMO_STEPS[si].tool]}
                  opacity={active ? 1 : 0.6}
                >
                  <title>{`${DEMO_STEPS[si].label} – bit ${DEMO_STEPS[si].tool + 1}`}</title>
                </circle>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

const OPTIONS: { value: ExportGrouping; icon: React.ReactNode; label: string; testid: string }[] = [
  { value: 'per-step', icon: <Files />, label: 'One file per step', testid: 'export-grouping-per-step' },
  { value: 'per-tool', icon: <Layers />, label: 'One file per tool', testid: 'export-grouping-per-tool' },
  { value: 'combined', icon: <FileCode2 />, label: 'One combined file', testid: 'export-grouping-combined' }
]

export function GroupingCards({
  value,
  onChange
}: {
  value: ExportGrouping
  onChange: (g: ExportGrouping) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="How to split the G-code into files">
      {OPTIONS.map((o) => {
        const active = o.value === value
        const help = HELP[`export.grouping.${o.value}`]
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={o.testid}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors',
              active
                ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40'
                : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full border',
                  active ? 'border-sky-400' : 'border-slate-500'
                )}
              >
                {active && <span className="size-2 rounded-full bg-sky-400" />}
              </span>
              <span className={cn('[&_svg]:size-4', active ? 'text-sky-300' : 'text-slate-400')}>
                {o.icon}
              </span>
              <span className="text-sm font-medium text-slate-100">{o.label}</span>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <p className="flex-1 text-[11px] leading-snug text-slate-400">{help?.body}</p>
            </div>
            <div className="pl-6">
              <GroupingIllustration grouping={o.value} active={active} />
            </div>
          </button>
        )
      })}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          example:
          {DEMO_STEPS.map((s, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: TOOL_COLORS[s.tool] }}
              />
              {s.label}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1">
          dot colour = bit
          <HelpTip title="Reading the little pictures">
            Each dot is one milling step and its colour is the bit (tool) it uses. Each page is one G-code
            file you will load into your machine. Steps that share a page run one after another in the same
            file.
          </HelpTip>
        </span>
      </div>
    </div>
  )
}
