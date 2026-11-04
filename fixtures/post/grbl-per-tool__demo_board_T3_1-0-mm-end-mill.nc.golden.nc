(TraceMill G-code - grbl post)
(Project: demo board)
(File: demo_board_T3_1-0-mm-end-mill.nc)
(Machine: GRBL 3018)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 1 min 16 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: TOP)
(Tools:)
(#3 1 mm flat end mill "1.0 mm end mill" - 15000 rpm)
(Steps:)
(1. Hole mill 3 mm [holeMill, top, T3])
(2. Board cutout [cutout, top, T3])
G21
G90 G94 G17
G0 Z5
(Tool #3 1 mm flat end mill "1.0 mm end mill" must be loaded and Z zeroed on the copper before starting)
(Step: Hole mill 3 mm [holeMill, top side] with tool #3 1 mm flat end mill "1.0 mm end mill")
M3 S10000
G4 P3
G0 X31 Y30
G0 Z1
G1 Z0 F50
G3 X31 Y30 Z-0.6 I-1 J0 F200
G3 X31 Y30 Z-1.2 I-1 J0
G3 X31 Y30 Z-1.8 I-1 J0
G3 X31 Y30 I-1 J0
G1 X30
G0 Z2
G0 Z5
(Step: Board cutout [cutout, top side] with tool #3 1 mm flat end mill "1.0 mm end mill")
G0 X-0.5 Y-0.5
G0 Z2
G1 Z-1.8 F50
G1 X50.5 F200
G1 Y40.5
G1 X-0.5
G1 Y-0.5
G0 Z2
G0 Z5
(End of program)
M5
G0 Z30
M30
