# Post-processors

PCB TraceMill turns toolpaths (`Toolpath[]`, millimetres, Z0 = top of copper) into G-code with
`postProcess()` from `src/core/post`. The machine profile's `postProcessor` field picks the
**dialect**; the dialect turns the profile into a flat `PostOptions` object, and a single
emitter (`ProgramWriter`) writes every dialect from those options.

```ts
postProcess(toolpaths, {
  machine, tools, grouping, projectName, doubleSided,
  date?,        // header date, default: now (ISO)
  flipPark?,    // XY to park at for a board flip, default X0 Y0
  flipAxis?     // 'x' | 'y', used in the operator message, default 'x'
}): GcodeFile[]
```

## Rules every dialect follows

- **Program start**: header comments (project, file, machine, date, units, estimated time,
  work zero, side, tool list, step list), units (`G21`/`G20`), modal setup, custom header
  lines, then `G0 Z<safeZ>`.
- **Safe height before XY rapids**: an XY rapid is only emitted when Z is at or above
  `min(safeZ, travelZ)`; otherwise the program first lifts to `safeZ`. Rapids never go into
  the material: a rapid whose target Z is ≤ 0 becomes a rapid down to `travelZ`, then a `G1`
  plunge at the tool's plunge feed.
- **Spindle before cutting**: every step starts the spindle (`M3 S<rpm>`, then `G4 P<sec>` if
  `spindleSpinUpSec > 0` and the spindle was off). Any feed move still finds the spindle on.
  RPM is clamped to `spindleMin..spindleMax`; feeds are clamped to `maxFeedXY` / `maxFeedZ`.
- **Unknown position**: after a tool change or flip pause the position is treated as unknown,
  so the next move lifts Z first. A feed whose start XY is unknown is preceded by a safe rapid.
- **Tool change** (between steps with different tools):
  - `supportsToolChange: true` → `M5`, `G0 Z<toolChangeZ>`, `T<n> M6`, and on Mach3/LinuxCNC
    `G43 H<n>` (tool length offset from the tool table; with an empty table this is H=0 and
    harmless). Generic adds a reminder to re-zero Z if the controller does not apply offsets.
  - otherwise → `M5`, `G0 Z<toolChangeZ>`, comment to re-zero Z on the copper, and
    `M0 (Insert tool #3 0.8 mm drill, then press cycle start)`.
  - The first tool of a file: `T<n> M6` on ATC machines; a comment otherwise (the operator loads
    it and zeroes Z before pressing start).
- **Board flip** (side changes inside one file — only possible with `combined`): `M5`, lift to
  `toolChangeZ`, `G0` to the park XY, then
  `M0 (FLIP THE BOARD NOW around the X axis, re-seat on the alignment pins, re-zero Z, then press Cycle Start)`.
- **Program end**: `G0 Z<safeZ>`, `M5`, `G0 Z<toolChangeZ>`, custom footer lines, `M30`
  (`M2` on LinuxCNC).
- Numbers: `machine.decimals` places with trailing zeros stripped (`X10`, `X1.5`); feeds 1
  decimal (mm/min) or 2 (in/min). Axis words that did not change are omitted; `F` only when it
  changes. Inch output divides every length and feed by 25.4 and emits `G20`.
- Comments are sanitised (`(`→`[`, `)`→`]`, non-ASCII replaced) so they never break a block.
- `estimatedSeconds` comes from running the finished program through `interpretGcode`
  (rapids at `maxFeedXY`), so it includes dwells, canned cycles and arc lengths.

## Dialects

|                                | mach3                              | grbl                  | linuxcnc                                                         | generic       |
| ------------------------------ | ---------------------------------- | --------------------- | ---------------------------------------------------------------- | ------------- |
| Modal setup                    | `G90 G94 G17 G40 G49 G80`, `G91.1` | `G90 G94 G17`         | `G90 G94 G17 G40 G49 G80`, `G91.1`, `G64 P0.01` (`P0.0004` inch) | `G90 G94 G17` |
| Comments                       | always `( )`                       | profile               | profile                                                          | profile       |
| Line numbers                   | profile                            | never                 | profile                                                          | profile       |
| Arcs `G2/G3` (I/J incremental) | profile                            | profile               | profile                                                          | profile       |
| Canned `G81`/`G83`             | profile                            | never                 | profile                                                          | profile       |
| `T M6`                         | profile (+`G43 H`)                 | profile (grblHAL ATC) | profile (+`G43 H`)                                               | profile       |
| `%` wrapper                    | no                                 | no                    | yes                                                              | no            |
| End                            | `M30`                              | `M30`                 | `M2`                                                             | `M30`         |
| Custom header/footer           | yes                                | yes                   | yes                                                              | yes           |

"profile" = taken from the `MachineProfile` flag. `G4 P` is seconds everywhere (Mach3 users
who configured "G4 in milliseconds" must change that setting back).

- **Mach3/Mach4**: `G91.1` makes I/J incremental regardless of the "IJ mode" setting in the
  Mach3 config, which otherwise silently mangles arcs.
- **GRBL 1.1**: no canned cycles (error:20) and no line numbers (they only consume the 128-byte
  serial buffer). Without an ATC, tool changes are `M5` + `M0` pauses; GRBL keeps `(…)` text
  out of its line buffer, so long comments are fine.
- **LinuxCNC**: `G64 P0.01` keeps motion smooth without rounding trace corners by more than
  10 µm.
- **Generic**: literally what the profile says. Use it for controllers we have not profiled.

### Canned drilling

When canned cycles are enabled, consecutive segments carrying `segment.drill` become one run:
`G98 G83 X.. Y.. Z-depth R<retract> Q<peck> F..` (or `G81` without peck), later holes with the same
parameters as bare `X.. Y..` lines, then `G80`. `G98` returns to the initial level (the
clearance height) between holes — slower than `G99` but safe with clamps on the stock.
Otherwise the segment's explicit moves are emitted.

## Grouping and file names

- `per-step` → one file per toolpath: `<project>_<NN>_<slug(stepName)>.<ext>`
- `per-tool` → consecutive toolpaths with the same tool **and the same side** share a file:
  `<project>_T<n>_<slug(toolName)>.<ext>`; a name that repeats gets `_2`, `_3`, …
  Toolpaths are never reordered (operation order matters, e.g. drill before cut-out) and never
  merged across a board flip.
- `combined` → `<project>.<ext>`, with tool-change and flip pauses inside.

`<project>` keeps case but replaces spaces and reserved characters with `_`.

Each `GcodeFile` has `lineMeta` with one entry per line: header/footer lines are `null`,
everything from a step's tool change to its last move carries that step's `stepId`/`toolId`.

## Adding a dialect

1. Add the id to `PostProcessorId` in `src/core/model/types.ts` (shared type — coordinate).
2. In `src/core/post/dialects.ts` create a `Dialect` whose `resolve(machine)` starts from
   `fromMachine(machine, id)` and overrides what the controller forces (comment style,
   preamble, end code, unsupported features).
3. Register it in `DIALECTS`.
4. If the controller needs a construct the writer cannot express, add an option to
   `PostOptions` and handle it in `ProgramWriter`/`postProcess.ts` — never branch on the
   dialect id inside the writer.
5. Add a case to `tests/unit/post/post.test.ts`, run
   `UPDATE_GOLDEN=1 npx vitest run tests/unit/post`, and review the new
   `fixtures/post/*.golden.nc` by hand (ideally in the controller's own simulator) before
   committing.

## Probe programs (auto-level)

`generateProbeProgram(cfg, machine)` in `src/core/heightmap` writes a serpentine probe grid,
always in `G21`, never changing work offsets:

- **GRBL**: `G38.2 Z<depth> F<feed>`; results are `[PRB:x,y,z:1]` lines in the sender console
  (machine coordinates — PCB TraceMill realigns X/Y to the grid via the first point, and Z is made
  relative to the first point). A miss raises an ALARM.
- **LinuxCNC**: `(PROBEOPEN probe-results.txt)` … `G38.2` … `(PROBECLOSE)`; the file holds
  `x y z a b c u v w` per point.
- **Mach3**: `G31`. Mach3 has no standard command to log probe hits; the conventional approach
  is a pair of user macros `M40.m1s` (`OpenDigFile()`) and `M41.m1s` (`CloseDigFile()`), after
  which every `G31` appends `x,y,z` to the chosen file. The program emits `M40`/`M41` with comments
  explaining this, and the fallback of reading `#2000-#2002` after each probe. `G31` does not
  error on a miss.
- **Generic**: `machine.probeCommand`, results imported as CSV.

The operator zeroes Z on the copper at the first probe point (min X / min Y); the height map is
normalised so that point is 0, and Z must not be re-zeroed between probing and milling.
