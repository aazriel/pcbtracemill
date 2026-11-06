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
Some Mach3 motion controllers never report the probe trip position: `#2000-#2002` and the M40 digitize file keep an old value although the machine stops at the right heights (measured on a user's Mach3 R3.043.062: the same stale triplet on every line, also after G4 or M0). The DRO is right, so the height is read through it in plain G-code: after the touch, `G92 Z0` makes the current position Z0 and `#5213` (the G92 Z offset) is then the touch height; `G92 Z#v` puts the old offset back (the offset active at the start is kept in `#498`). Each point is touched fast at the probe feed, lifted 0.2 mm and touched again at F10 (`MACH3_SLOW_FEED`); on that machine this was repeatable to about ±0.01 mm with 5 µm Z steps, against 25 µm scatter with one F50 touch. Cell k is stored in `#(500 + k)`; at the end every height is made relative to point 1 (`#ref = 0`), cells that were not probed get an IDW mix of the 4 nearest probed ones, and `#499 = 1` marks a complete run. At most 500 cells.
Mach3 keeps these variables until it is closed, so nothing is imported: step 2 becomes "Probing done", which stores a `HeightMap` with `mach3Vars = 500` and zero `z`. `applyHeightMap` then writes each corrected Z as a formula, e.g. `Z[-0.1+[0.25*#512]-[0.05*#513]]` (bilinear weights, the reference cell left out), also for drill cycles, inch and G91 files. The Z touch-off before each bit uses the cutting bit, so it touches **once, slowly** (at most F10 = `MACH3_SLOW_FEED`, for every dialect): a fast first touch at the probe feed broke a 0.1 mm V-bit tip on a user's machine before Mach3 stopped. F10 is also the feed of the final touch of the grid, so Z0 is found like the heights were. The G-code interpreter evaluates `#` parameters and `[...]` expressions (unknown = 0) so previews and time estimates keep working. Digitize file and TraceMill macros (D-016) stay as options.
