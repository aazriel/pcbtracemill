/**
 * Plain-language help texts shown next to inputs. Written for someone who has never milled anything.
 * Keys are dotted paths: `material.*`, `step.*` (general step fields), `isolation.*`, `clear.*`, `cutout.*`,
 * `drill.*`, `holeMill.*`, `alignment.*`, `autolevel.*`, `export.*`, `concept.*`.
 */

export interface HelpEntry {
  title: string
  body: string
}

export const HELP: Record<string, HelpEntry> = {
  // ───────────────────────────────────────── Material
  'material.width': {
    title: 'Stock width',
    body: 'The left-to-right size of the copper-clad sheet you put on the machine. It must be at least as wide as the board.'
  },
  'material.height': {
    title: 'Stock height',
    body: 'The front-to-back size of the copper-clad sheet. It must be at least as tall as the board.'
  },
  'material.thickness': {
    title: 'Board thickness',
    body: 'How thick the whole sheet is, including copper. Measure it with calipers; 1.6 mm is the most common. Cutout and drilling depths are based on it.'
  },
  'material.copperThickness': {
    title: 'Copper thickness',
    body: 'How thick the copper layer is. Most boards have 0.035 mm ("1 oz"); some have 0.07 mm ("2 oz"). Isolation only needs to cut a little deeper than this.'
  },
  'material.offsetX': {
    title: 'Board X position',
    body: 'How far from the left edge of the stock the board starts. Use it to place the board where the sheet is undamaged.'
  },
  'material.offsetY': {
    title: 'Board Y position',
    body: 'How far from the front (bottom) edge of the stock the board starts.'
  },
  'material.rotation': {
    title: 'Board rotation',
    body: 'Turns the board on the stock, e.g. 90° to fit a long board on a sheet the other way round. Stick to 0°, 90°, 180° or 270°.'
  },
  'material.origin': {
    title: 'Work zero position',
    body: 'Which corner of the stock (or its centre) you will set as X0 Y0 on your machine. Before running the job, jog the bit to that spot and zero X and Y there.'
  },
  'material.doubleSided': {
    title: 'Double-sided board',
    body: 'Turn on if your board has copper on both sides and you want traces on both. You will mill one side, flip the board over, then mill the other.'
  },
  'material.useDefaults': {
    title: 'Automatic stock size',
    body: 'While on, the stock size follows the board size plus a small margin. Turn off to type in the size of the sheet you actually have.'
  },
  'material.alignment.enabled': {
    title: 'Alignment pins',
    body: 'Drills two holes outside the board and into the spoilboard. After flipping, pins in these holes put the board back in exactly the right place.'
  },
  'material.alignment.axis': {
    title: 'Flip direction',
    body: 'X places the pins left and right of the board, on a line running left-to-right: you flip the board over that line, so its front edge goes to the back (like flipping a calendar page). Y places the pins front and back: you flip it left over right (like turning a book page).'
  },
  'material.alignment.pinDiameter': {
    title: 'Pin diameter',
    body: 'The size of the pins you will push into the holes (for example 3 mm dowel pins or drill bit shanks). The holes are made this size.'
  },
  'material.alignment.margin': {
    title: 'Pin distance',
    body: 'How far from the board edge each pin hole centre sits. It must be more than half the pin diameter so the hole does not cut into the board, and the stock must be big enough to hold it.'
  },

  // ───────────────────────────────────────── Step general
  'step.name': {
    title: 'Step name',
    body: 'A name for this step, shown in the job list and as a comment in the G-code.'
  },
  'step.enabled': {
    title: 'Enabled',
    body: 'Disabled steps are kept in the list but are not included in the G-code.'
  },
  'step.side': {
    title: 'Side',
    body: 'Which side of the board faces up while this step runs. Bottom-side steps are mirrored automatically, so they line up after you flip the board.'
  },
  'step.layers': {
    title: 'Source layers',
    body: 'Which imported file(s) this step works from, e.g. the top copper layer for isolation or the drill file for drilling.'
  },
  'step.tool': {
    title: 'Tool',
    body: 'The bit used for this step. Only tools that suit the step are offered; recommended ones are listed first.'
  },
  'step.cutDepth': {
    title: 'Cut depth',
    body: "How far below the copper surface the bit goes at its deepest. Deeper cuts are split into several passes automatically using the tool's depth per pass."
  },
  'step.safeZ': {
    title: 'Safe height',
    body: "How high above the board the bit lifts before moving to a new spot. Leave empty to use the machine's default."
  },

  // ───────────────────────────────────────── Isolation
  'isolation.passes': {
    title: 'Number of passes',
    body: 'How many grooves are cut side by side around each trace. One pass is fastest; two or three give wider gaps that are easier to solder without bridges.'
  },
  'isolation.overlap': {
    title: 'Pass overlap',
    body: 'How much each extra pass overlaps the previous one, from 0 (just touching) to 0.9 (90%). Some overlap (around 0.4) avoids thin copper slivers between passes.'
  },
  'isolation.direction': {
    title: 'Cut direction',
    body: 'Climb or conventional milling (see "Climb vs conventional"). Climb usually gives cleaner copper edges on PCB machines.'
  },
  'isolation.extraClearance': {
    title: 'Extra clearance',
    body: 'Moves the first groove this much further away from the traces. Leave at 0 unless traces come out too thin or the bit cuts into them.'
  },

  // ───────────────────────────────────────── Clear
  'clear.overlap': {
    title: 'Pass overlap',
    body: 'How much side-by-side clearing passes overlap, from 0 to 0.9. More overlap leaves fewer copper whiskers but takes longer.'
  },
  'clear.direction': {
    title: 'Cut direction',
    body: 'Climb or conventional milling (see "Climb vs conventional").'
  },
  'clear.minIslandArea': {
    title: 'Ignore tiny islands',
    body: 'Copper patches smaller than this area (in mm²) that are not part of any trace are simply cleared away instead of being milled around.'
  },
  'clear.clearMargin': {
    title: 'Clearing margin',
    body: 'Only removes copper within this distance of your traces. 0 removes all unused copper, which takes much longer.'
  },

  // ───────────────────────────────────────── Cutout
  'cutout.tabs': {
    title: 'Number of tabs',
    body: 'Small bridges of material left uncut so the board stays attached to the sheet until the job finishes. Break them by hand afterwards and sand the edge.'
  },
  'cutout.tabWidth': {
    title: 'Tab width',
    body: 'How long each tab is along the outline. 2–4 mm is usually strong enough.'
  },
  'cutout.tabHeight': {
    title: 'Tab height',
    body: 'How thick the tabs are, measured from the bottom of the board. Thicker tabs hold better but are harder to break off.'
  },
  'cutout.outside': {
    title: 'Cut outside the line',
    body: 'On: the bit runs just outside the outline so the board ends up exactly the drawn size. Off: it runs inside (used for internal cutouts).'
  },

  // ───────────────────────────────────────── Drill
  'drill.peck': {
    title: 'Peck depth',
    body: 'Drills in small steps of this depth, pulling out between them to clear chips. 0 drills each hole in one go, which is fine for normal PCBs.'
  },
  'drill.retract': {
    title: 'Retract height',
    body: 'How high above the board the drill lifts between holes. A small value (1–2 mm) saves a lot of time on boards with many holes.'
  },
  'drill.minDiameter': {
    title: 'Smallest hole',
    body: 'Only holes at least this big are drilled in this step. Use the size range to give each drill bit its own group of holes.'
  },
  'drill.maxDiameter': {
    title: 'Largest hole',
    body: 'Only holes up to this size are drilled in this step.'
  },
  'drill.includeSlots': {
    title: 'Include slots',
    body: 'Also handle oval slots (e.g. for some connectors) by drilling along them.'
  },

  // ───────────────────────────────────────── Hole milling
  'holeMill.minDiameter': {
    title: 'Smallest hole to mill',
    body: 'Holes at least this big are milled. Usually set just above your largest drill bit, so drills handle the rest.'
  },
  'holeMill.maxDiameter': {
    title: 'Largest hole to mill',
    body: 'Holes up to this size are milled in this step.'
  },
  'holeMill.helical': {
    title: 'Spiral down (helical)',
    body: 'On: the bit spirals gently down into the hole, which is easier on small end mills. Off: it plunges straight down for each layer and then cuts a circle.'
  },

  // ───────────────────────────────────────── Auto-level
  'autolevel.what': {
    title: 'What is auto-leveling?',
    body: 'Copper boards are never perfectly flat, and isolation cuts are only about 0.1 mm deep. Auto-leveling measures the board height at many points and adjusts the G-code so the cut depth stays even everywhere.'
  },
  'autolevel.probing': {
    title: 'What is probing?',
    body: 'The machine lowers the bit slowly until it touches the copper, which closes an electric circuit (a clip on the bit and one on the board). It records that height and moves on to the next point.'
  },
  'autolevel.heightmap': {
    title: 'Height map',
    body: 'The grid of measured heights from probing. TraceMill uses it to raise or lower every move so it follows the real surface of the board.'
  },
  'autolevel.grid': {
    title: 'Probe grid',
    body: 'How many points are measured across and along the board. More points follow the surface better but take longer; about one point every 10 mm works well.'
  },
  'autolevel.probeFeed': {
    title: 'Probe speed',
    body: 'How fast the bit moves down while looking for the copper. Slow (20–50 mm/min) is more accurate and gentler on the bit.'
  },
  'autolevel.probeDepth': {
    title: 'Maximum probe depth',
    body: 'How far below zero the machine searches before giving up. If it reaches this without touching, check the probe wiring.'
  },
  'autolevel.clearanceZ': {
    title: 'Probe clearance',
    body: 'How far the bit lifts above the copper it just touched before it moves to the next point. By default 5 % of the spacing (0.5 mm at 10 mm): enough for a warped board, and much faster than a fixed couple of millimetres.'
  },

  // ───────────────────────────────────────── Export
  'export.grouping': {
    title: 'File grouping',
    body: 'How the G-code is split into files. Machines without a tool changer usually work best with one file per tool, so each file runs without stopping.'
  },
  'export.grouping.per-step': {
    title: 'One file per step',
    body: 'Each step gets its own file. Easy to re-run a single step if something goes wrong.'
  },
  'export.grouping.per-tool': {
    title: 'One file per tool',
    body: 'All steps that use the same bit go into one file. You change the bit, re-zero Z, and load the next file.'
  },
  'export.grouping.combined': {
    title: 'One combined file',
    body: 'Everything in one file. The program pauses and asks you to change the bit when needed; you must re-zero Z after each change.'
  },

  // ───────────────────────────────────────── Concepts
  'concept.origin': {
    title: 'Origin (X0 Y0)',
    body: 'The point on the stock that the machine treats as the starting position. All moves in the G-code are measured from it, so set it on your machine at the same place you chose here.'
  },
  'concept.z0': {
    title: 'Z zero',
    body: 'Height zero is the top of the copper. Before each job, and after every bit change, lower the bit until it just touches the copper and set Z to 0 there.'
  },
  'concept.safeZ': {
    title: 'Safe Z',
    body: 'A height above the board where the bit can move freely without hitting anything. All moves between cuts happen at or above this height.'
  },
  'concept.climb': {
    title: 'Climb vs conventional',
    body: "These describe which way the bit's teeth meet the material as it moves. Climb milling usually leaves cleaner edges on PCBs; conventional is gentler on loose or wobbly machines. If edges look torn, try the other."
  },
  'concept.overlap': {
    title: 'Overlap',
    body: 'When passes run next to each other, overlap is how much each one covers the previous one. 0.4 means 40% of the cut width is cut twice, which avoids leaving thin strips behind.'
  },
  'concept.tabs': {
    title: 'Tabs',
    body: 'Little uncut bridges that keep the board attached during cutout. Without them the board could come loose and be hit by the spinning bit.'
  },
  'concept.doubleSided': {
    title: 'Double-sided boards',
    body: 'Mill the top side first, then flip the board and mill the bottom. TraceMill mirrors the bottom side automatically, so after flipping everything lines up.'
  },
  'concept.flip': {
    title: 'Flipping the board',
    body: 'When the program pauses for the flip, lift the board off, turn it over along the flip direction, and push it back onto the alignment pins. Do not move X or Y zero, but re-check Z zero.'
  },
  'concept.alignment': {
    title: 'Why alignment pins?',
    body: 'Holes drilled through the board into the spoilboard hold pins exactly in place. Because both pins sit on the flip line, the flipped board lands precisely where the bottom-side G-code expects it.'
  },
  'concept.spoilboard': {
    title: 'Spoilboard',
    body: 'A sacrificial flat board under your PCB. Drills and the cutout go slightly into it so they cut cleanly through the PCB without damaging your machine table.'
  },
  'concept.stepDown': {
    title: 'Depth per pass',
    body: 'Deep cuts are split into several shallower passes so the bit is never overloaded. Small bits need small steps.'
  },
  'concept.stepOver': {
    title: 'Stepover',
    body: 'How far the bit moves sideways between neighbouring passes, as a share of its cutting width.'
  }
}

export function getHelp(key: string): HelpEntry | undefined {
  return HELP[key]
}
