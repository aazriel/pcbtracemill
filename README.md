# TraceMill — PCB Gerber → G-Code CAM Studio

TraceMill turns PCB fabrication files (Gerber RS-274X X1/X2 + Excellon) into G-code for hobby CNC routers: isolation routing, copper clearing, drilling, hole milling, board cutout with tabs, double-sided alignment, a realistic material-removal simulation and auto-levelling.

- **Import**: Gerber X1/X2, Excellon PTH/NPTH, ZIP archives and folders; KiCad, Altium, Eagle and EasyEDA naming; automatic layer type & side detection (overridable).
- **Manufacture**: machine presets (Mach3 primary, GRBL, LinuxCNC, Generic), material editor with live preview, step editor with validation, tool library with a starter kit, one-click Recipe.
- **Simulation**: top-down heightfield simulation (WebGL) with tool-accurate walls, timeline markers and G-code sync.
- **Export**: per-step / per-tool / combined files, probe-program generation, probe import, heat map + 3D surface, Z correction.

## Development

```bash
npm install
npm run dev          # Electron app with hot reload
npm test             # unit + golden tests (Vitest)
npm run lint && npm run typecheck
npm run test:e2e     # Playwright Electron end-to-end (use xvfb-run on headless Linux)
npm run dist         # installers for the current OS (electron-builder)
```

Architecture: all CAM logic lives in `src/core` (pure TypeScript, no DOM/Electron/React; runs in Node and Web Workers). The renderer (`src/renderer`) talks to `src/workers` through comlink. See `docs/DECISIONS.md`, `docs/USER_GUIDE.md`, `docs/POSTPROCESSORS.md`.

`scripts/make-demo-board.mjs` generates the demo KiCad board in `fixtures/boards/demo-kicad`; `scripts/smoke.mjs` renders any stage in headless Chromium for screenshots.

License: MIT.
