/**
 * In-app help: a short guide to the four stages, keyboard & mouse shortcuts, a glossary of the CNC
 * words used in the app, and an About page. Opened from the Help menu, F1 or the (?) in the header.
 */
import type { ReactNode } from 'react'
import {
  BookOpen,
  CircuitBoard,
  Download,
  Factory,
  Info,
  Keyboard,
  Layers,
  PlayCircle,
  Rocket,
  type LucideIcon
} from 'lucide-react'
import { HELP } from '@core/help'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { SetupGuide } from '@renderer/heightmap/SetupGuide'

interface Topic {
  id: string
  label: string
  icon: LucideIcon
  body: () => ReactNode
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-slate-100">{title}</h3>
      <div className="space-y-2 text-[13px] leading-relaxed text-slate-300">{children}</div>
    </section>
  )
}

function Steps({ items }: { items: ReactNode[] }): React.JSX.Element {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-600/25 text-[11px] font-semibold text-sky-200">
            {i + 1}
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  )
}

function Tip({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100">
      {children}
    </div>
  )
}

function Keys({ rows }: { rows: [string, string][] }): React.JSX.Element {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-slate-800/80 last:border-0">
            <td className="w-48 py-1.5 pr-3">
              {k.split(' + ').map((part, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1 text-slate-600">+</span>}
                  <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                    {part}
                  </kbd>
                </span>
              ))}
            </td>
            <td className="py-1.5 text-slate-300">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const B = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <b className="font-semibold text-slate-100">{children}</b>
)

export const HELP_TOPICS: Topic[] = [
  {
    id: 'start',
    label: 'Getting started',
    icon: Rocket,
    body: () => (
      <>
        <Section title="What PCB TraceMill does">
          <p>
            PCB TraceMill turns the fabrication files of a printed circuit board (Gerber + drill files) into
            G-code that a hobby CNC router runs to <B>mill</B> the board out of copper-clad material. You do
            not need to know anything about CNC: every field has a <B>(?)</B> bubble that explains it.
          </p>
        </Section>
        <Section title="The four stages">
          <p>Work flows left to right through the stages at the top of the window:</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              [CircuitBoard, 'Board', 'Import your Gerber & drill files and check the layers.'],
              [Factory, 'Manufacture', 'Pick the machine, the material and the milling steps.'],
              [PlayCircle, 'Simulation', 'Watch a realistic 3D preview of the job before you cut.'],
              [Download, 'Export', 'Save the G-code files and optionally auto-level the board.']
            ].map(([Icon, t, d], i) => {
              const I = Icon as LucideIcon
              return (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex items-center gap-2 font-semibold text-slate-100">
                    <I className="size-4 text-sky-400" /> {i + 1}. {t as string}
                  </div>
                  <p className="mt-1 text-[12px] text-slate-400">{d as string}</p>
                </div>
              )
            })}
          </div>
          <p>
            Each stage has a status circle: <span className="text-emerald-400">✓</span> ready,{' '}
            <span className="text-amber-400">!</span> works but has a warning,{' '}
            <span className="text-rose-400">✕</span> needs fixing, ◯ not started. Hover a circle to see why.
          </p>
        </Section>
        <Section title="Your first board in five minutes">
          <Steps
            items={[
              <>
                In <B>Board</B>, click <B>Choose files…</B> or <B>Choose a folder…</B>, pick the program you
                designed the board with, then select your Gerber and drill files.
              </>,
              <>
                Check that the <B>File status</B> shows copper, board outline and drill holes.
              </>,
              <>
                In <B>Manufacture</B>, choose your machine, check the material size and press <B>Recipe</B>{' '}
                for a complete set of milling steps.
              </>,
              <>
                In <B>Simulation</B>, press play (or <B>End</B>) and check the result in 3D.
              </>,
              <>
                In <B>Export</B>, save the G-code and run it on your machine.
              </>
            ]}
          />
        </Section>
      </>
    )
  },
  {
    id: 'board',
    label: '1 · Board',
    icon: CircuitBoard,
    body: () => (
      <>
        <Section title="Importing files">
          <p>
            Use <B>Choose files…</B> or <B>Choose a folder…</B> (or drag & drop). If everything is in a ZIP,
            use <B>Import a ZIP…</B>. The first time — and whenever no layers are loaded — PCB TraceMill asks
            which <B>design program</B> made the files, so the picker only shows that program&rsquo;s
            fabrication files and the right names are recognised. Change it any time in the <B>Settings</B>{' '}
            menu.
          </p>
          <p>
            Importing a file that is already loaded asks whether to <B>Replace</B> it (e.g. after you changed
            your design), <B>Keep both</B>, or <B>Skip</B> it.
          </p>
        </Section>
        <Section title="Layers">
          <p>Every file becomes a layer. For each one you can:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>show or hide it (eye), change its colour (square), drag it to change the drawing order;</li>
            <li>
              set its <B>Type</B> (copper, outline, drill…) and <B>Side</B> (board top / bottom) when the
              automatic guess is wrong. <span className="text-emerald-400">AUTO</span> means the detected
              values are used; after a change it shows <span className="text-amber-400">MANUAL</span>. Pick
              the detected values again (or click MANUAL) to go back to automatic;
            </li>
            <li>re-import it from disk or delete it (buttons appear when you hover the layer).</li>
          </ul>
        </Section>
        <Section title="File status">
          <p>
            Copper is <B>required</B>. Board outline and drill holes are <B>recommended</B>: without them the
            board cannot be cut out or drilled. For copper, silkscreen and solder mask the status also shows
            which <B>board sides</B> were found.
          </p>
        </Section>
        <Section title="The view">
          <p>
            <B>View</B> switches between the board <B>Top</B>, the <B>Bottom</B> (mirrored, as if you flipped
            it) and <B>Both</B> sides at once. <B>Realistic colours</B> shows a finished PCB;{' '}
            <B>Highlight traces</B> lights up a whole connection when you hover copper. The dashed rectangle
            is the material.
          </p>
        </Section>
      </>
    )
  },
  {
    id: 'manufacture',
    label: '2 · Manufacture',
    icon: Factory,
    body: () => (
      <>
        <Section title="Machine and material">
          <p>
            <B>Machine</B>: pick a preset (Mach3, GRBL, LinuxCNC…) or add your own. <B>Material</B>: the
            copper-clad sheet — size, thickness, where the design sits on it, the work zero (X0 Y0) and
            whether it is double-sided (then two alignment pins keep the board in place when you flip it).
          </p>
        </Section>
        <Section title="Steps">
          <p>Steps are the milling operations, run from top to bottom:</p>
          <Keys
            rows={[
              ['Isolate traces', 'Cuts a groove around every trace and pad (30° V-bit)'],
              ['Clear copper', 'Removes leftover copper between traces (flat end mill)'],
              ['Drill holes', 'Drills component and via holes (PCB drill)'],
              ['Mill big holes', 'Mills holes bigger than your drills in a spiral'],
              ['Cut out board', 'Cuts the board free along the outline, leaving tabs'],
              ['Alignment pins', 'Pin holes for double-sided flipping']
            ]}
          />
          <Tip>
            <B>Recipe</B> builds a complete, sensible plan from your layers — a good starting point you can
            then adjust.
          </Tip>
        </Section>
      </>
    )
  },
  {
    id: 'simulation',
    label: '3 · Simulation',
    icon: PlayCircle,
    body: () => (
      <>
        <Section title="Watching the job">
          <p>
            A realistic preview of the whole job on your material. Use the controls next to the timeline to
            play, pause, change speed (1×–200×), jump between steps, or jump to the <B>end</B> to see the
            final board. Coloured markers on the timeline show where steps and tools change.
          </p>
          <p>
            The right panel shows the live <B>X Y Z</B> tool position and what the machine is doing, the
            display options (tool, trail, design overlay, rapids) and the G-code — click a line to jump there.
          </p>
        </Section>
        <Section title="3D view">
          <Keys
            rows={[
              ['Drag', 'Rotate around the board'],
              ['Right-drag', 'Pan (also Shift + Drag)'],
              ['Wheel', 'Zoom towards the cursor'],
              ['Alt + Drag', 'Move the light (sun) around the board'],
              ['Double-click', 'Fit the whole material in view']
            ]}
          />
          <p>
            Switch to <B>2D</B> for a flat top view. <B>Design</B> overlays your design copper so you can
            check that what is milled matches what you designed.
          </p>
        </Section>
      </>
    )
  },
  {
    id: 'export',
    label: '4 · Export',
    icon: Download,
    body: () => (
      <>
        <Section title="Saving G-code">
          <p>
            Choose <B>one file per step</B>, <B>one per tool</B> or <B>one combined file</B>, then save them
            in your machine&rsquo;s format (Mach3 .tap, GRBL .nc, LinuxCNC .ngc…). Bottom-side files are
            marked — flip the board before running them.
          </p>
        </Section>
        <Section title="Auto-level (recommended)">
          <Steps
            items={[
              <>
                <B>Generate probe program</B>, then run it with a probe clip on the bit and a wire on the
                copper.
              </>,
              <>
                <B>Import probe results</B>: PCB TraceMill shows a heat map and 3D surface and corrects the
                depth in every exported file.
              </>
            ]}
          />
        </Section>
      </>
    )
  },
  {
    id: 'setup',
    label: 'Board setup',
    icon: Layers,
    body: () => <SetupGuide />
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: Keyboard,
    body: () => (
      <>
        <Section title="Everywhere">
          <Keys
            rows={[
              ['Ctrl + N', 'New project'],
              ['Ctrl + O', 'Open project'],
              ['Ctrl + S', 'Save project'],
              ['Ctrl + I', 'Import files'],
              ['Ctrl + Z', 'Undo'],
              ['Ctrl + Shift + Z', 'Redo'],
              ['F1', 'Open this help']
            ]}
          />
        </Section>
        <Section title="Board view">
          <Keys
            rows={[
              ['Wheel', 'Zoom'],
              ['Drag', 'Pan'],
              ['Double-click', 'Fit the board in view'],
              ['Click', 'Freeze / release a highlighted trace']
            ]}
          />
        </Section>
        <Section title="Simulation">
          <Keys
            rows={[
              ['Space', 'Play / pause'],
              ['← / →', 'Previous / next step or tool change'],
              ['Home', 'Back to the untouched board'],
              ['End', 'Jump to the final result']
            ]}
          />
        </Section>
      </>
    )
  },
  {
    id: 'glossary',
    label: 'Glossary',
    icon: BookOpen,
    body: () => (
      <Section title="CNC words used in PCB TraceMill">
        <dl className="space-y-3">
          {Object.entries(HELP)
            .filter(([k]) => k.startsWith('concept.'))
            .map(([k, e]) => (
              <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <dt className="font-semibold text-slate-100">{e.title}</dt>
                <dd className="mt-0.5 text-[12px] text-slate-400">{e.body}</dd>
              </div>
            ))}
        </dl>
      </Section>
    )
  },
  {
    id: 'about',
    label: 'About',
    icon: Info,
    body: () => (
      <Section title="PCB TraceMill">
        <p>PCB Gerber → G-code CAM studio for hobby CNC routers.</p>
        <p className="text-slate-400">
          Isolation routing, copper clearing, drilling, hole milling, board cutout with tabs, double-sided
          alignment, a realistic material-removal simulation and auto-levelling.
        </p>
        <p className="text-slate-500">Free and open source under the MIT licence.</p>
      </Section>
    )
  }
]

export function HelpDialog({
  open,
  topic,
  onTopic,
  onClose
}: {
  open: boolean
  topic: string | null
  onTopic: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const current = HELP_TOPICS.find((t) => t.id === topic) ?? HELP_TOPICS[0]
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="PCB TraceMill Help"
      className="w-[min(94vw,920px)]"
    >
      <div className="flex h-[min(70vh,620px)] gap-4" data-testid="help-dialog">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-slate-800 pr-3">
          {HELP_TOPICS.map((t) => {
            const I = t.icon
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTopic(t.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  t.id === current.id
                    ? 'bg-sky-600/20 text-sky-100 ring-1 ring-sky-500/40'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                )}
              >
                <I className="size-4 shrink-0" />
                {t.label}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto pr-1">{current.body()}</div>
      </div>
    </Dialog>
  )
}
