# TraceMill — Design Decisions

Ambiguities in the spec are resolved in favour of the safest, most conventional CNC behaviour. Each entry: decision, then rationale.

## D-001 Polygon library: `clipper2-ts` instead of `clipper2-js`

`clipper2-js@1.2.4` produced corrupt offset output (10×10 square offset by 1 mm gave a self-intersecting polygon) and wrong point-in-polygon results, and its PolyTree execution returns `false`. `clipper2-ts` (BSL-1.0, MIT-compatible, a faithful TS port of Clipper2) passes our geometry tests. We use flat path output and rebuild nesting by orientation + containment (`src/core/geometry`).

## D-002 Units and coordinate frame

Internal units are millimetres (float64). Z0 = top copper surface; negative Z cuts into material. Board geometry is stored as authored (viewed from top). Bottom-side mirroring, stock offset, rotation and origin are applied only when toolpaths are generated.

## D-003 Default stock size

"Board size + 5 mm for X and Y" is interpreted as **+5 mm total per axis** (2.5 mm margin per side), board centred in the stock. The user can enlarge it; a stock smaller than the board is flagged as an error.

## D-004 Integer precision

Clipper works on integers scaled 10 000 per mm (0.1 µm), well beyond CNC resolution while staying far within 2^53.

## D-005 Core purity

`src/core/**` must not import DOM/Electron/React/Zustand — enforced via ESLint `no-restricted-imports`.

## D-006 Gerber parsing
- Each contour inside one G36/G37 becomes its own `region` object; regions use even-odd fill so KiCad cut-in holes are correct.
- X2 attribute keys keep the leading dot (`.N`, `.AperFunction`); values are everything after the first comma. KiCad's `G04 #@! TF/TA/TO` legacy comments are honoured.
- Rectangle/obround/polygon draws are swept as the exact convex hull of the aperture at both ends.
- Load transforms apply mirror → rotate → scale; deprecated image transforms (`%AS %MI %SF %IR %OF`) are applied with a warning; `%IPNEG` only warns.
- Missing `%MO` → inch (spec default) with a warning; missing `%FS` → LA 3.6 with a warning. Incremental coordinates are treated as absolute with a warning.
- Recoverable problems never throw; they become `ParsedLayer.warnings`.

## D-007 Excellon parsing
- Integer coordinates use the declared format (`INCH,LZ,00.0000`, `;FILE_FORMAT=a:b`, KiCad `;FORMAT={a:b/…}`), defaulting to inch 2.4 / metric 3.3.
- Units default to inch (Excellon default); if undeclared and every tool diameter > 0.25 we assume metric, with a warning.
- Plating per hole: tool `TA.AperFunction` > file `TF.FileFunction` / `;TYPE=` > filename (`NPTH`, `-PTH`) > caller hint > plated.
- `M30` ends the program; `M00` is a stop and parsing continues. Routed arcs are split into short straight slots.

## D-008 Layer detection
Priority: X2 `FileFunction` (0.99) > EDA naming tables (the user's chosen EDA first) > generic extension table > name keywords > content sniffing. Excellon content always overrides a non-drill name guess. Altium `GKO`/`GM1` → outline; `GM2..GM16` → outline only if the content looks like a closed thin-line outline, otherwise fab. Junk (BOM, PnP, reports, images, job files) is skipped and listed to the user.

## D-009 Tools & steps
| Step | Allowed tools (preferred first) | Layers |
|---|---|---|
| Drill holes | drill | drill |
| Clear copper | flat (preferred), V-bit, ball | copper |
| Cut out board | corn (preferred), flat | outline |
| Mill big holes | flat, corn | drill |
| Isolate traces | V-bit (preferred), flat, ball | copper |
| Alignment pins | drill (preferred), flat | none |

Corn bits are excluded from clearing: their teeth leave a rough floor and cut into the fibreglass. Default depths: isolation/clear `max(0.1, 2×copper+0.02)`; cutout thickness+0.1; drill thickness+0.3; hole mill thickness+0.2; alignment thickness+2 (pins sit in the spoilboard).

## D-010 Recipe order
Alignment pins → first side (isolate, drills smallest→largest, hole milling) → flip → second-side isolation → cutout last. Pins first so the spoilboard holes fix the flip position; drilling after isolation so the V-bit doesn't catch burrs, and before the flip so the second isolation pass cleans burrs. A design with copper on both sides switches the material to double-sided + alignment pins automatically (the user is told).

## D-011 Coordinate frames
Stock frame: 0..width × 0..height viewed from above, top side up. Board → stock: board bbox min to origin, rotate CCW about the board centre, re-anchor, translate by (offsetX, offsetY). Bottom side: mirror about the stock centre line (alignment axis `x` → y' = H − y; axis `y` → x' = W − x). Work = stock shifted by the chosen origin corner. Z0 is always the top copper surface of the face being machined.

## D-012 Alignment pins
Two pins on the flip centre line, one each side of the placed board; `margin` is the distance from the board edge to the pin **centre** (the material and toolpath modules originally disagreed — unified on centre). Because they lie on the flip line they map onto themselves when the board is flipped.

## D-013 Milling direction
Spindle M3 (clockwise). Climb milling = material on the right of travel. Isolation/cutout climb → the tool travels clockwise around copper/board. Geometry is transformed to work coordinates before orientation is decided, so bottom-side mirroring can never swap climb for conventional. Hole milling is CCW (climb inside a hole).

## D-014 Safe motion
XY rapids only at Z ≥ min(safeZ, travelZ); rapids never go to Z ≤ 0 (rapid to 0.5 mm above copper, then plunge at plunge feed). After M0/M6 the position is treated as unknown and Z is lifted first. Spindle starts each step with a G4 spin-up dwell when it was off. RPM and feeds are clamped to the machine limits.

## D-015 Tool changes & flipping
ATC machines: `T n M6` (+ `G43 H n` for Mach3/LinuxCNC). Manual machines: `M5`, lift to tool-change Z, `M0 (Insert tool #n …)` and a re-zero Z reminder. The first tool of a file is only a comment (the operator loads it before starting). A side change inside a combined file emits a FLIP block (spindle off, lift, park at X0 Y0, `M0 (FLIP THE BOARD NOW …)`). Per-tool grouping merges only consecutive toolpaths with the same tool **and** side, never reordering. Canned drilling uses `G98` (return to clearance) rather than the faster `G99` for safety.

## D-016 Auto-levelling
No G92/G10: the operator zeroes Z on the copper at the first grid point (min X / min Y), and the map is normalised so that point is 0. GRBL uses `G38.2` (results from the `[PRB:…]` log), LinuxCNC `G38.2` with `(PROBEOPEN)`/`(PROBECLOSE)`, Mach3 `G31` with its own `M40`/`M41` digitize-file macros by default (works out of the box). With some motion-controller plugins that file holds wrong numbers (every Z = max depth, or one position repeated on every line) although the machine probed correctly; such logs are rejected with a hint (D-024), and the probe dialog can instead emit the TraceMill macros `M401` (new file) / `M402` after every G31 (waits for `IsMoving()` to clear, appends the DRO X,Y,Z to `C:/Mach3/TraceMill-probe.txt`) – an opt-in last resort. Missing grid cells are filled by inverse-distance weighting. Correction subdivides cutting moves to ≤ 1 mm and adds the bilinear-interpolated height; rapids above 0.5 mm are untouched.

## D-017 Simulation model
One 2.5-D heightfield per face (Z0 = that face's copper top), which is exact for a 3-axis machine. The tool profile is inverted numerically from `toolRadiusAtHeight`, so every tool type gives its true wall shape (V-bit sloped, flat end mill vertical, ball rounded). Through-cuts propagate to the other face. Seeking is exact (bitwise deterministic) thanks to copy-on-write 64×64 tile checkpoints. Rapids are stamped too, so a rapid into material shows as a crash.

## D-018 Project files
`.tmill` is pretty-printed JSON with a format marker and version; parsed geometry is stripped and rebuilt from the embedded raw file text on load. Newer versions are refused with a friendly message; older ones go through a migration hook.

## D-019 Silkscreen engraving
`engrave` steps follow the **centre-lines** of the artwork strokes (chained into long polylines to minimise lifts); filled shapes without a centre-line (flashes, regions) are traced along their outline. Default depth = copper + 0.03 mm (min 0.05 mm) — a light scratch. Engraving cuts copper exactly like isolation, so the generator warns with the length of artwork that runs over design copper on that side. Recipe never adds it automatically.

## D-020 Auto-level persistence
The "apply correction" switch and the side that was probed are stored in `ProjectSettings` (`autoLevelApply`, `autoLevelSide`). A height map fits only the side that faced up during probing; files for the other side are exported uncorrected and say so. (Per-side maps are a planned follow-up.)

## D-021 Starter drills
The starter kit includes 0.3 / 0.4 / 0.5 mm carbide drills (common via sizes) with a gentle 40 mm/min plunge, so typical designs drill every hole without warnings.

## D-022 Origin on the board
`material.originOn` chooses whether `material.origin` (a corner or the centre) refers to the copper-clad sheet (`stock`, default) or to the board as placed on it for the **top** side (`board`). Either way the work zero is one fixed point on the machine bed for both sides, so the operator never re-zeroes X/Y after flipping; on the bottom side that point is generally no longer a board corner. Every stock↔work transform therefore takes the board bbox (`workOriginInStock`, `stockToWork`, `stockSideToWork`, `stockRectInWork`).

## D-023 Skipping parts of a step (advanced)
`CamStep.skip = { enabled, items }` lists parts of the board, in board coordinates, that a step leaves alone. It is only offered when Settings → "Advanced: allow skipping parts" is on, and it is only applied while `skip.enabled`. A `copper` item is any point inside a copper area (one polygon of the union of the step's layers). Each isolation pass drops the pieces of its rings that lie within that pass's offset distance (+0.02 mm) of a skipped area, so only the grooves that "belong" to that area are left out; narrow-gap problems inside the skipped band are not reported. A `hole` item matches a hole by centre (±0.02 mm) and diameter; drill and hole-mill steps leave it out. Every skip produces a step warning, so a step with skipped parts never shows as plain "ready".

## D-024 Probe result checks and Z touch-off
Imported probe results are checked before a map is built (`core/heightmap/check.ts`). Points at the program's maximum probe depth never touched the copper (Mach3 `G31` silently stops there): all of them, point 1 (the reference) or ≥ 30 % of them → the results are rejected with an explanation and a checklist; fewer are left out and filled by IDW with a warning. Identical heights everywhere are rejected (also without a known grid). For Mach3 / LinuxCNC logs (work coordinates) every point is compared with the program's point in the same order; ≥ 10 % recorded elsewhere (soft limit, wrong X0/Y0) is rejected. GRBL logs skip these checks (failed probes are `:0` / alarms, coordinates are machine).
Corrected files can find Z0 themselves (`addZTouchOff`, Export → Auto-level step 3, `ProjectSettings.autoLevelTouchOff`, default on): before the first spindle start and after every `M0`/`M1`/`M6`, `M5`, `M0` (set Z roughly, clip on), `G0 Z safe`, `G0` to point 1, `G0 Z1`, probe to `Z-1` at the **probe feed of the height map** (same trip overshoot as the reference), set Z0 (`G10 L20 P0 Z0` for GRBL/LinuxCNC, `G92 Z0` for Mach3/generic), `G0 Z safe`, `M0` (remove the clip). It runs after the height-map correction, so its moves are not levelled. The probe program itself still never changes offsets (D-016). Probing is recommended with a sturdy bit or pin, not the V-bit.

## D-025 Mach3 probing with G-code variables (default for Mach3)
Some Mach3 motion controllers never report the probe trip position: `#2000-#2002` and the M40 digitize file keep an old value although the machine stops at the right heights (measured on a user's Mach3 R3.043.062: the same stale triplet on every line, also after G4 or M0). The DRO is right, so the height is read through it in plain G-code: after the touch, `G92 Z0` makes the current position Z0 and `#5213` (the G92 Z offset) is then the touch height; `G92.1` clears it again. The program starts with `G92.1` and an `M0` (re-zero Z with Zero Z if the DRO changed). This is exactly the sequence that was measured on the user's Mach3; an earlier version kept an active G92 offset (`#498 = #5213`, restored with `G92 Z#v` after each point), which was never measured on a machine and gave a map far flatter than the real board (the bit about 1 mm above the copper 90 mm from point 1). The Z touch-off of the corrected files also clears G92 (`G92.1`) before the operator sets Z roughly, so its `G92 Z0` is the same plain case. Each point is touched fast at the probe feed, lifted 0.25 mm (`MACH3_RETOUCH_LIFT`, editable as `ProbeGridConfig.retouchLift` under Advanced) and touched again at F10 (`MACH3_RETOUCH_FEED`); only the slow touch is recorded. A 0.2 mm lift at F10 was repeatable to about ±0.01 mm on that machine (5 µm Z steps, against 25 µm scatter with one F50 touch). A 1 mm lift at F20 was tried after the board seemed to bend under the fast touch; once the probe stopped on time the user found 1 mm too much and F20 not visibly slower than the probe feed, so it is 0.25 mm at F10 (enough for a board to spring back). Cell k is stored in `#(500 + k)`; at the end point 1 is touched once more into `#497` and every height is made relative to that value (`#ref = 0`) – the first touch of a program is the least trustworthy one on Mach3 (it was seen to run ahead of the motion at the start of a program), and the reference shifts every height, cells that were not probed get an IDW mix of the 4 nearest probed ones, and `#499 = 1` marks a complete run. At most 500 cells.
Mach3 keeps these variables until it is closed, so nothing is imported: step 2 becomes "Probing done", which stores a `HeightMap` with `mach3Vars = 500` and zero `z`. `applyHeightMap` then writes each corrected Z as a formula, e.g. `Z[-0.1+[0.25*#512]-[0.05*#513]]` (bilinear weights, the reference cell left out), also for drill cycles, inch and G91 files. The Z touch-off before each bit uses the cutting bit, so it touches **once, very slowly** (at most F2 = `MACH3_SLOW_FEED`, for every dialect), starting 0.5 mm above the rough zero (≤ about 18 s): a fast first touch at the probe feed broke a 0.1 mm V-bit tip on a user's machine before Mach3 stopped, and the user asked for F2. On that machine the probe stopped 0.02 mm past contact at F10, so F2 also sets Z0 a little closer to the real copper than the F10 grid touches (≈ 0.015 mm shallower cut). The G-code interpreter evaluates `#` parameters and `[...]` expressions (unknown = 0) so previews and time estimates keep working. Digitize file and TraceMill macros (D-016) stay as options.

## D-026 Probe Z0 without a height map
Export → "Find Z zero with the probe before each bit" (`ProjectSettings.autoLevelProbeZero`, default **off** – it needs a probe clip) adds the same Z touch-off as D-024 (one slow F2 touch with the cutting bit, `G92 Z0` / `G10 L20 P0 Z0`) to every file that is **not** height-corrected. The touch point is point 1 of the default probe grid of the file's side (board area + 2 mm margin, clamped to the stock, min X / min Y), so it is the same place a later height map would use. A file that mills both sides is left alone when the two sides' points differ (it would need another point after the flip). Corrected files keep the Auto-level step 3 switch (`autoLevelTouchOff`), which touches at the map's point 1.

## D-027 Lift between probe points
The lift between probe points (`ProbeGridConfig.clearanceZ`) is **relative to the point just touched**: `G91 G0 Z<lift> G90` after each touch, then the XY move, then the probe to the absolute max depth. By default it follows the spacing (`autoProbeLift`: 5 %, 10 mm → 0.5 mm, 20 mm → 1 mm, at least 0.3 mm); moves longer than the grid spacing (row ends on board-shaped grids) lift proportionally more. The start, the end, and the long move back to point 1 go to an absolute `max(2, lift)`. A small absolute clearance would hit a board that rises more than that between point 1 and a far point; a small relative one only has to clear the slope between neighbours. The probe dialog shows both lifts in a collapsed "Advanced" section (automatic switch + value, and the Mach3 re-touch lift). If a point does not touch, the next move is low over the board – the program header says to stop the machine then.

## D-028 V-bit feeds
A 0.1 mm V-bit tip survives about 0.004 mm per spindle turn: the starter 0.1 mm V-bits cut at 50 mm/min and plunge at 20 mm/min at 12 000 rpm (100 mm/min at 24 000 rpm is the same load); 0.2 mm tips at 100 / 30. The earlier 200–300 mm/min snapped tips on a user's machine. Projects that still carry the old starter feeds untouched (`OLD_VBIT_FEEDS`) get the new ones when loaded (`refreshStarterFeeds`); tools the user edited are kept.


## D-029 Run-time estimate with acceleration
Estimated times (file header, export table, step results, simulator play-back) use one motion model, `gcode/motionTime.ts`: every axis accelerates at `MachineProfile.accel` (mm/s², optional, default 50 – a typical Mach3 hobby router; Machine → Work area & limits). Rapids start and stop, and X/Y and Z each run at their own limit (`maxFeedXY` / `maxFeedZ`), the slower one decides. Chains of feed moves keep their speed through gentle corners: the speed at a joint is the lower feed × cos(angle), with a forward/backward pass so the machine can always brake in time. M0/M1 and probe touches stop the motion. A probe move (G31 / G38.x) is timed down to Z0, where it is expected to touch, not to its search limit. Time waiting at M0 for the operator is not counted. Measured on a user's Mach3 router: an auto-levelled isolation file of 21 000 short moves ran 1 h 22 min 55 s; the old model (length ÷ feed, Z rapids at the XY rate) said 1 h 17 min, this one says 1 h 22 min.

## D-030 Lower default heights, slower probe touch
The built-in machines use safe Z 2 mm and travel Z 1 mm (was 5 / 2): a PCB is flat and clamped, and every lift costs time on Z axes limited to a few hundred mm/min. Projects whose built-in machine still has the old untouched values get the new ones on load (`refreshPresetHeights`); edited machines are kept. The fast probe touch defaults to 20 mm/min (was 50), which does not press a thin board down before the probe trips; it moved into the probe dialog's Advanced section with the lifts.

## D-031 Isolation settings from the measured copper spacing
After import every copper layer is measured in a second, background CAM worker (`analyzeClearance`, like a DRC): each place where two different copper features come closer than 1.5 mm **with nothing between them** is one measurement. Gaps under 0.1 mm (`MILLABLE_GAP`) are copper meant to touch or slivers – no bit can cut them – and are only counted. The **narrowest millable gap** is what the isolation must get through (`clearance`); the width most places share (`typical`, ≥ 2 places and 3 %) is reported too. The plan is made for the narrowest gap, not the typical one: a centred pass sized for a 0.4 mm design rule would short the few 0.2 mm places.

`planIsolation` (recipe, choosing a tool in the step editor, "Use the recommended settings"):
- depth: at most 0.05 mm for 0.2 mm gaps, 0.06 / 0.3, 0.07 / 0.4, 0.08 / 0.5, 0.1 from 0.6 mm (interpolated), never above the usual copper depth and never shallower than copper + 0.015 mm;
- gaps ≤ 0.5 mm: **one pass**, extra clearance (gap − groove) / 2 rounded down to 0.005 mm, so the groove runs in the middle of the narrowest gap; a groove wider than the gap is reported (choose a finer V-bit);
- wider gaps: two passes, unless the second would add more than 30 min (estimated from the copper outline length at the tool feed, or from the last generated toolpath);
- overlap by tool type: V-bit 50 % (its full width exists only at full depth, a few hundredths of board height change make the groove barely wider than the tip), ball 40 %, flat / corn 15 %; not used with one pass.
The step editor shows the reasoning, the time extra passes add (from the live preview against the generated step, shown from 30 min), and a button to go back to the recommendation. Probe spacing recommendation: 10 mm under 0.5 mm gaps, 15 mm under 1.2 mm, else 20 mm.

## D-032 Copper clearing without isolation
A Clear copper step with no enabled Isolate step before it on the same side (sharing a copper layer) is what separates the copper: every place its bit cannot pass between two copper features is reported as a narrow-gap problem with a warning that the board will be shorted there. After an isolation step, leftover copper is cosmetic and is no longer reported.

## D-033 One touch per probe point
The Mach3 variables probe program touches each point once at the probe feed (20 mm/min) and records that touch. The slow re-touch (lift 0.25 mm, touch again at F10) is an Advanced option (`ProbeGridConfig.retouch`, default off): on a user's machine the two touches agreed within ±10 µm (mean −2 µm over 19 points), and when the probe input stayed active after the first touch the re-touch did not move at all and stored a height nobody measured.

## D-034 Smart clearance: one groove down the middle of narrow gaps
Isolation option `IsolationParams.smart` (+ `smartMaxGap`, default 1 mm; recommended by the plan, D-031). A pass along each copper edge puts two grooves into every narrow gap, each hugging a trace; a groove that comes out a little wide (V-bit slightly too deep) eats into both traces. With smart clearance every gap up to `smartMaxGap` between two DIFFERENT copper features is cut once, along its middle; elsewhere the passes follow the copper as usual.
- Middle lines: the copper outlines are sampled (0.05 mm) and labelled per feature; in their Delaunay/Voronoi diagram (`delaunator`) an edge between two points of different features lies on the line equally far from both. Edges where the gap is ≤ smartMaxGap are chained into polylines, simplified, and kept only where the groove fits (gaps narrower than the groove are reported, as before).
- Narrow zone: the Delaunay triangles that span such a gap (corners on two different features). Slots inside one feature (thermal reliefs) are not part of it. The outline is traced from triangle neighbours (no polygon booleans), simplified and closed by 0.1 mm.
- Pass k = outline of (copper grown by its offset ∪ narrow zone): the usual pass in open areas, and where a narrow gap ends it crosses the gap, so the middle groove ends on it - isolation is closed by construction, every outline is a loop (one plunge). Small holes of that outline (< 0.5 × smartMaxGap²) are pockets the triangles missed and are filled, unless a middle groove ends in them (where three features meet that outline is what joins the grooves).
- Verified by simulating the cut (copper left after the grooves, one group per feature) on a 0.2 mm board, a 0.2/0.4 mm board and the demo board: same isolation as the normal passes; machine time 36 instead of 62 min and 17 instead of 30 min.
