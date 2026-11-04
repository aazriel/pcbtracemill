# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TraceMill is an Electron + React + TypeScript desktop app that turns PCB fabrication files (Gerber RS-274X X1/X2, Excellon) into G-code for hobby CNC routers. It covers isolation, copper clearing, drilling, hole milling, cutout with tabs, double-sided alignment, material-removal simulation and auto-levelling.

## Commands

```bash
npm run dev            # Electron app with hot reload (electron-vite)
npm run build          # electron-vite build -> out/
npm test               # Vitest unit + golden tests (tests/unit/**, src/**/*.test.ts)
npm run lint           # eslint, --max-warnings=0
npm run typecheck      # tsc for tsconfig.node.json, tsconfig.web.json and tests/e2e
npm run test:e2e       # builds, then runs Playwright against Electron (xvfb-run -a on headless Linux)
npm run dist           # installers for the current OS (electron-builder -> release/)
```

- Single test file: `npx vitest run tests/unit/post/post.test.ts`. Single test by name: add `-t "<name>"`.
- **Golden files** in `fixtures/` (`*.golden.json`, `*.golden.nc`, `*.golden.tmill`) are compared by gerber, excellon, import, post, heightmap and project tests. After an intentional output change, regenerate them with `UPDATE_GOLDEN=1 npx vitest run tests/unit/<area>` (PowerShell: `$env:UPDATE_GOLDEN='1'; npx vitest run ...`). Then review the diff in the golden files.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck and test on Windows, macOS and Linux, and e2e on Linux only. All of them must pass with zero warnings.
- `scripts/make-demo-board.mjs` regenerates `fixtures/boards/demo-kicad`. `scripts/smoke.mjs --stage board|manufacture|simulation|export --out x.png` serves `out/renderer` in headless Chromium and takes a screenshot. Run a build first. The Chromium `executablePath` is hard-coded to `/opt/pw-browsers/chromium`.
- Prettier: single quotes, no semicolons, print width 110, no trailing commas.

## Architecture

There are four layers. Path aliases `@core`, `@shared`, `@renderer` and `@workers` are defined in `tsconfig.base.json`, `electron.vite.config.ts` and `vitest.config.ts`. Keep all three in sync.

1. **`src/core`**: all CAM logic, written as pure TypeScript. It runs in Node (tests) and in Web Workers. ESLint forbids imports of react, electron, zustand and `@renderer` here (DECISIONS D-005). Inside core, modules use relative imports.
   - Data flows `import` (detect/sniff layer type and side, expand ZIPs) → `gerber`/`excellon` parsers → `geometry` (Clipper2 via `clipper2-ts`, integers scaled to 10 000 per mm) → `cam` (steps, validation, material, recipe) → `toolpath` (one generator per step kind) → `post` (dialects → `PostOptions` → a single `ProgramWriter`) → G-code. `gcode` interprets G-code for time estimates and the simulator. `sim` is a heightfield material-removal simulation. `heightmap` handles probe programs, probe parsing and Z correction. `project` handles `.tmill` (de)serialisation.
   - `src/core/pipeline/{import,cam,sim}.ts` are the top-level entry points that the workers expose. Shared types live in `src/core/model/types.ts`.
   - Recoverable parse problems never throw. They become `warnings` on the result.
2. **`src/workers`**: `cam.worker.ts` (import, CAM, interpret, probe) and `sim.worker.ts`, exposed through comlink. `src/workers/index.ts` lazily creates the worker proxies (`camWorker()`, `simWorkerApi()`).
3. **`src/renderer/src`**: the React 19 UI, styled with Tailwind v4 and Radix primitives. The UI is organised in stages: `board → manufacture → simulation → export` (`store/ui.ts`).
   - `store/project.ts` holds the undoable document as Zustand + immer + zundo `temporal`. Heavy parsed geometry is kept outside the store, in `parsedCache` keyed by layer id. That cache is not undoable and not persisted, and `parsedVersion` is bumped whenever it changes.
   - `store/controller.ts` orchestrates the stores and workers. Components should call controller functions rather than talking to workers directly.
   - Simulation rendering is WebGL (`sim/SimGL.ts`): one full-screen fragment shader that either looks straight down (top view) or ray-marches the heightfield from an orbit camera (`sim/camera3d.ts`, default 3D view) and ray-traces the cutter from its true profile. It renders a "sharp" surface (`hsharp`: flat copper tops, steps below the copper layer, vertical through-cuts) built on smoothed contours, with normals differentiated over one screen pixel, so edges stay crisp at any zoom without showing the cell grid. Lighting is a user-movable sun (`lightAz`/`lightEl` in the sim store) with GGX metal shading for copper. The 2D overlay (`sim/overlay.ts`) draws the trail in both views and the tool only in the top view. The 3D height map uses three.js. The G-code viewer uses Monaco, loaded lazily.
4. **`src/main` + `src/preload`**: the Electron main process. `ipc.ts` handles file read/save, project open and settings (electron-store). `menu.ts` builds the menu. The preload bridge is typed in `src/preload/index.d.ts` and `src/shared/ipc-types.ts`.

## Domain conventions (see docs/DECISIONS.md)

`docs/DECISIONS.md` is the record of CNC-behaviour choices. Read the relevant entry before changing toolpath or post-processor behaviour, and add a new `D-0xx` entry for new decisions. Key invariants:

- Internal units are millimetres. Z0 is the top copper surface of the face being machined, and negative Z cuts into material. Board geometry is stored as authored (viewed from the top). Mirroring for the bottom side, stock offset, rotation and origin are applied only when toolpaths are generated (D-002, D-011).
- Climb milling with M3 is decided after the transform into work coordinates. Isolation and cutout go clockwise around material, and hole milling goes CCW (D-013).
- Safe-motion rules hold for every dialect: no XY rapid below `min(safeZ, travelZ)`, no rapid to Z ≤ 0, and Z lifts after M0/M6 because the position is then unknown (D-014). `docs/POSTPROCESSORS.md` specifies the exact output for each dialect: mach3 (primary), grbl, linuxcnc and generic.
- Recipe order: alignment pins → first side (isolate, drill, mill holes) → flip → second side → cutout (D-010).
- `.tmill` files are JSON with a version. Parsed geometry is stripped on save and rebuilt from the embedded raw file text on load. Format changes need a migration (D-018).

`docs/USER_GUIDE.md` describes the user-facing workflow.
