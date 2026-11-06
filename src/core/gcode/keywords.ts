/** Short G-code reference used by the editor (hover help / completion). */

export interface GcodeKeyword {
  /** e.g. "G0", "M3", "F". */
  code: string
  /** One-line description. */
  description: string
}

export interface GcodeLanguageKeywords {
  gCodes: GcodeKeyword[]
  mCodes: GcodeKeyword[]
  /** Address words (X, Y, F, ...). */
  words: GcodeKeyword[]
}

export const gcodeLanguageKeywords: GcodeLanguageKeywords = {
  gCodes: [
    { code: 'G0', description: 'Rapid move (maximum speed, no cutting)' },
    { code: 'G1', description: 'Linear feed move at the current feed rate F' },
    { code: 'G2', description: 'Clockwise arc (I/J centre offset or R radius)' },
    { code: 'G3', description: 'Counter-clockwise arc (I/J centre offset or R radius)' },
    { code: 'G4', description: 'Dwell for P seconds' },
    { code: 'G10', description: 'Set coordinate system / tool table data' },
    { code: 'G17', description: 'Select XY plane for arcs' },
    { code: 'G18', description: 'Select XZ plane for arcs' },
    { code: 'G19', description: 'Select YZ plane for arcs' },
    { code: 'G20', description: 'Units: inches' },
    { code: 'G21', description: 'Units: millimetres' },
    { code: 'G28', description: 'Return to home position (via optional intermediate point)' },
    { code: 'G30', description: 'Return to secondary home position' },
    { code: 'G31', description: 'Straight probe (Mach3): move until the probe input triggers' },
    { code: 'G38.2', description: 'Straight probe toward workpiece, error if no contact' },
    { code: 'G38.3', description: 'Straight probe toward workpiece, no error if no contact' },
    { code: 'G40', description: 'Cutter radius compensation off' },
    { code: 'G43', description: 'Apply tool length offset (H word)' },
    { code: 'G49', description: 'Cancel tool length offset' },
    { code: 'G53', description: 'Move in machine coordinates (this line only)' },
    { code: 'G54', description: 'Select work coordinate system 1' },
    { code: 'G61', description: 'Exact path mode' },
    { code: 'G64', description: 'Path blending with tolerance P (LinuxCNC)' },
    { code: 'G80', description: 'Cancel canned cycle' },
    { code: 'G81', description: 'Drilling cycle: feed to Z, rapid out to R / initial level' },
    { code: 'G82', description: 'Drilling cycle with dwell P at the bottom' },
    { code: 'G83', description: 'Peck drilling cycle: Q = peck depth' },
    { code: 'G90', description: 'Absolute distance mode' },
    { code: 'G91', description: 'Incremental (relative) distance mode' },
    { code: 'G90.1', description: 'Arc centre I/J absolute' },
    { code: 'G91.1', description: 'Arc centre I/J relative to arc start (default)' },
    { code: 'G92', description: 'Set temporary coordinate offset' },
    { code: 'G93', description: 'Inverse time feed mode' },
    { code: 'G94', description: 'Units-per-minute feed mode' },
    { code: 'G98', description: 'Canned cycle: retract to initial Z level' },
    { code: 'G99', description: 'Canned cycle: retract to R plane' }
  ],
  mCodes: [
    { code: 'M0', description: 'Program pause - press Cycle Start to continue' },
    { code: 'M1', description: 'Optional pause (when optional stop is enabled)' },
    { code: 'M2', description: 'Program end' },
    { code: 'M3', description: 'Spindle on clockwise (speed S)' },
    { code: 'M4', description: 'Spindle on counter-clockwise (speed S)' },
    { code: 'M5', description: 'Spindle stop' },
    { code: 'M6', description: 'Tool change to tool T' },
    { code: 'M7', description: 'Mist coolant on' },
    { code: 'M8', description: 'Flood coolant on' },
    { code: 'M9', description: 'Coolant off' },
    { code: 'M30', description: 'Program end and rewind' },
    { code: 'M40', description: 'Mach3 (custom macro): open digitize file' },
    { code: 'M41', description: 'Mach3 (custom macro): close digitize file' },
    { code: 'M401', description: 'TraceMill Mach3 macro: start a new probe results file' },
    { code: 'M402', description: 'TraceMill Mach3 macro: wait until stopped, write the probed X,Y,Z' }
  ],
  words: [
    { code: 'X', description: 'X axis coordinate' },
    { code: 'Y', description: 'Y axis coordinate' },
    { code: 'Z', description: 'Z axis coordinate (Z0 = copper surface in TraceMill)' },
    { code: 'I', description: 'Arc centre X offset' },
    { code: 'J', description: 'Arc centre Y offset' },
    { code: 'R', description: 'Arc radius, or canned-cycle retract plane' },
    { code: 'Q', description: 'Peck depth increment (G83)' },
    { code: 'P', description: 'Dwell time in seconds / parameter' },
    { code: 'F', description: 'Feed rate (units per minute)' },
    { code: 'S', description: 'Spindle speed (RPM)' },
    { code: 'T', description: 'Tool number' },
    { code: 'H', description: 'Tool length offset index' },
    { code: 'N', description: 'Line number' }
  ]
}
