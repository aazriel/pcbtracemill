(TraceMill G-code - mach3 post)
(Project: demo board)
(File: demo_board_03_hole-mill-3-mm.tap)
(Machine: Mach3 router)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 15 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: TOP)
(Tools:)
(#3 1 mm flat end mill "1.0 mm end mill" - 15000 rpm)
(Steps:)
(1. Hole mill 3 mm [holeMill, top, T3])
G21
G90 G94 G17 G40 G49 G80
G91.1
G0 Z5
G0 Z30
T3 M6 (Load tool #3 1 mm flat end mill "1.0 mm end mill")
G43 H3
(Step: Hole mill 3 mm [holeMill, top side] with tool #3 1 mm flat end mill "1.0 mm end mill")
M3 S15000
G4 P2
G0 Z5
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
(End of program)
M5
G0 Z30
M30
