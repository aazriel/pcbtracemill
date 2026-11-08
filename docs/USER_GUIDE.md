# PCB TraceMill User Guide

PCB TraceMill turns the fabrication files of a printed circuit board (Gerber + drill files) into G-code that a hobby CNC router can run to **mill** the board out of copper-clad material. You do not need to know anything about CNC to use it — every field in the app has a description and a **(?)** help bubble.

The work flows through four stages shown at the top of the window:

**1 Board → 2 Manufacture → 3 Simulation → 4 Export**

Each stage shows a status circle: ✓ ready, **!** has warnings, ✕ needs fixing, ◯ not started.

---

## 1. Board — import your design

1. Drag & drop your Gerber files, drill files, a whole folder or a ZIP onto the window (or use **Choose files…**).
2. The first time, PCB TraceMill asks **which design program** made the files (KiCad, Altium, Eagle, EasyEDA, other). This lets it recognise file names and ignore files that are not needed (BOMs, reports, pick-and-place files…). Ignored files are listed under the layer list.
3. Every file becomes a **layer** in the left panel:
   - 👁 show / hide it (the eye at the top shows/hides all layers),
   - drag the grip to change drawing order,
   - click the colour square to change its colour,
   - change its **type** (copper, solder mask, silkscreen, outline, drill…) and **side** if detection guessed wrong. Detected values show **AUTO 🔒**; once you change them it shows **MANUAL** — click it to go back to automatic,
   - size, number of points and pads are shown under each layer,
   - re-import (after changing your design) or delete.
4. The **File status** box tells you what was found: copper is required; board outline and drill holes are recommended (without them PCB TraceMill cannot cut the board out or drill holes); silkscreen, solder mask and fab layers are optional.
5. In the view: scroll to zoom, drag to pan, double-click to fit, use the ruler to measure. **Top/Bottom** flips the view. **Realistic colours** shows the board as a finished PCB. **Highlight traces**: hover copper to light up the whole connection (net); click to freeze the highlight.
6. The dashed rectangle around the board is the **material** (by default the board plus 5 mm).

Press **Continue** when the status circle is green.

## 2. Manufacture — machine, material and steps

### Machine
Shows the selected machine. **Change** opens the machine picker: built-in presets (Mach3 router, GRBL 3018, Genmitsu, LongMill, Shapeoko, LinuxCNC, desktop PCB mills…) and your own machines. Each card shows the work area, spindle, heights, output format and capabilities (arcs, drilling cycles, automatic tool change, probing). Duplicate a preset to customise it, or **Add a new machine**.

### Material
The copper-clad board you will mill: width × height × thickness and copper thickness. **Edit** opens a live preview where you set the size, where the design sits on it (offset, rotation), the **origin** (the point the machine calls X0 Y0 — shown as a dot) – either click a corner, or say which way the job runs from it (**→ right / ← left** along X, **↑ away / ↓ toward you** along Y) and whether the board is **double-sided**. For double-sided boards PCB TraceMill drills two **alignment pins** on the flip line so the board lands in exactly the same place after you turn it over. **Set to default** = design size + 5 mm. A red ✕ means the material is too small.

### Steps
Steps are the milling operations, run top to bottom:

| Step | What it does | Typical tool |
|---|---|---|
| Isolate traces | Cuts a groove around every trace and pad so they are electrically separated | 30° V-bit |
| Clear copper | Removes the leftover copper between traces | flat end mill |
| Drill holes | Drills component and via holes | PCB drill |
| Mill big holes | Mills holes bigger than your drills in a spiral | flat end mill |
| Cut out board | Cuts the board free along the outline, leaving small tabs | corn / router bit |
| Alignment pins | Drills the pin holes for double-sided flipping | drill |

- **Recipe** creates a complete, sensible plan from your layers.
- **Isolation settings follow your board.** After import PCB TraceMill measures the gaps between the copper in the background. The recipe – and choosing a bit in an isolation step – set the passes, depth and extra clearance from the narrowest gap: gaps up to 0.5 mm get one pass in the middle of the gap and a shallow cut (0.05 mm for 0.2 mm gaps), wider gaps two passes unless the second one would add more than half an hour. The step shows why, warns when extra passes add 30 minutes or more, and **Use the recommended settings** puts the values back. A **Clear copper** step without an isolation step before it lists every place its bit cannot pass – those stay shorted.
- **Smart clearance** (isolation step, on in the recommended settings): every gap up to 1 mm between two traces or pads is cut once, down its middle, instead of a pass along each side - a groove that comes out a little wide eats the gap, not your traces, and the job is much shorter. Where the copper is further apart the passes follow it as usual.
- While you edit a step with auto-generate on, the **Results** (time, length) are recalculated as you type and show "--" until the new value is ready.
- **Add step** lets you build your own. The step editor has sections — **Layer**, **Tool**, **General**, the step's **parameters**, and **Results** (estimated time and cut length). Each section shows ✓ / ! / ✕; a step is *Ready* only when all are ✓.
- Edit, duplicate, disable (skipped in G-code) or delete a step; drag to reorder.
- Steps are grouped by board side (**Top side**, **Bottom side**) with a thin **↻ Flip the board** divider between them. Steps of the same kind that follow each other (e.g. one drill step per drill size) fold into one row — click it to open the group, or use its checkbox to switch them all on/off. Click a step to see its layers, bit and actions.
- In the Simulation the view turns over by itself where the job flips the board, with a large notice.
- G-code is regenerated automatically after each change; switch **Auto-regenerate** off while making many edits and press **Generate** when done.
- **Skip parts (advanced).** Turn on *Settings → Allow skipping traces and holes in a step*. Isolation, drilling and hole-milling steps then get a **Skip parts** section: click a trace/pad or a hole on the board to leave it out of that step (red), click again to bring it back. Skipped parts are drawn in red in the Manufacture view, the step card shows ⊘ and a warning, so it is always visible that something is left alone. A skipped copper area gets no isolation groove and stays connected to the copper around it.

### Tool library
Six tabs: All, Flat end mill, Ball end mill, Drill, V-bit, Corn/PCB router. The **starter kit** contains common PCB tools (locked — duplicate them to customise). **Create my own tool** to add yours: name, kind, geometry, feeds & speeds and notes, with a live drawing of the tool. In a step, only compatible tools can be selected; double-click a tool to use it.

## 3. Simulation

A realistic, top-down preview of the whole job on your material: shiny copper, milled fibreglass, clean walls shaped by the actual tool. Play/pause, speeds 1×…200×, jump to the end to see the final result, drag the timeline (coloured markers show where steps and tools change). Toggle the trailing tool path and the **design copper overlay** to confirm that what is milled matches your design. Switch **Top/Bottom** to look at either face; work done on one side is kept when the job flips. The G-code panel follows the tool line by line; click a line to jump there.

## 4. Export

Choose **one file per step**, **one per tool**, or **one combined file**. The table lists each file with its size and estimated run time (it includes the machine's acceleration – set **Acceleration** in the machine settings to your Mach3 Motor Tuning value for the closest estimate; time you spend at pauses is not counted); **Save** writes them in your machine's format (Mach3 `.tap`, GRBL `.nc`, LinuxCNC `.ngc`, …). Bottom-side files are marked — flip the board before running them.

**Find Z zero with the probe before each bit** (off by default) works without probing the board: each file that is not height-corrected stops before every bit; set Z zero only roughly (a sheet of paper), clip the probe on and press Start. The bit touches the copper slowly near the front-left corner of the board (point 1 of the probe grid), sets Z0 there, and stops so you can remove the clip.

### Auto-level (optional, recommended)
Copper is only 0.035 mm thick and no board is perfectly flat, so PCB TraceMill can measure the surface and correct the depth:
1. **Generate probe program** — read the safety notes, choose the probing area and grid, save the program and run it with a probe clip on the bit and a wire on the copper. The area is given by its left / right edges (X) and front / back edges (Y), all measured from X0 Y0, the same zero you use for milling; *Board shape* follows the real outline (on a round board the far corners are skipped and filled in from their neighbours), *Whole material* covers the sheet, and *Custom* lets you type the edges or draw on the picture: drag a rectangle, drag a circle out from its centre, or click the corners of a polygon (click the first point or double-click to finish, Esc to start over). Only the points inside a drawn circle or polygon are probed. Every setting's (?) shows a short animation of what it does.
   Probe with a sturdy bit (a 1–3 mm flat end mill or a steel pin), not the V-bit: where the copper doesn't conduct the bit is pushed into the board. The picture shows X0 Y0 with arrows for X+ and Y+, and how far point 1 is from X0 Y0 in each direction.
2. **Run it, then load the results** — with **Mach3** the probe program keeps every height in Mach3 variables by default (*G-code variables*: nothing to install, no file). Each point is touched once at 20 mm/min (a second, slow touch can be switched on under *Advanced*). Between points the bit lifts only a little above the copper it just touched (5 % of the spacing: 0.5 mm at 10 mm); both lifts can be changed under *Advanced* in the probe dialog. When it has finished press *Probing done*; the corrected files read the heights, so mill in the same Mach3 session (if Mach3 was closed, probe again). The probe dialog can also use Mach3's digitize file or the PCB TraceMill macros instead. For other controllers, load the log your controller produced. PCB TraceMill checks it first: if the probe never touched the copper (every point at the maximum probe depth), point 1 failed, or the machine recorded the points somewhere else than it was sent (soft limit, wrong X0 Y0), the results are refused with a list of things to check. Good results open the height map viewer (colour heat map and 3D surface); it can be opened again with *View height map*.
3. **Save the corrected G-code** — with *Correct the G-code with the height map* on, every file for the probed side follows the measured surface. *Find Z zero at point 1 for each bit* (on by default) makes each corrected file stop before every bit: set Z zero only roughly (a sheet of paper), clip the probe to the bit and press Start; the machine touches the copper at point 1 very slowly (F2, so a 0.1 mm V-bit tip survives) and sets the exact Z0 there, then stops so you can remove the clip before the spindle starts. Press *Save corrected G-code files*.

## Projects
Save your work as a `.tmill` project (File → Save). It contains the original files, machine, material, tools, steps and height map. Undo/redo with Ctrl+Z / Ctrl+Shift+Z. PCB TraceMill also keeps your current work by itself: when you start it again it offers to **restore the last session**. The short welcome tour can be opened again from *Help → Take the Tour*.
