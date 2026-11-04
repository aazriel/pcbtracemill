(TraceMill G-code - mach3 post)
(Project: demo board)
(File: demo_board_02_drill-0-8-mm.tap)
(Machine: Mach3 router)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 13 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: TOP)
(Tools:)
(#2 0.8 mm drill - 10000 rpm)
(Steps:)
(1. Drill 0.8 mm [drill, top, T2])
G21
G90 G94 G17 G40 G49 G80
G91.1
G0 Z5
G0 Z30
T2 M6 (Load tool #2 0.8 mm drill)
G43 H2
(Step: Drill 0.8 mm [drill, top side] with tool #2 0.8 mm drill)
M3 S10000
G4 P2
G0 Z2
G98 G83 X5 Y5 Z-1.8 R1 Q0.6 F100
X15 Y5
G81 X25 Y5 Z-1.8 R1 F100
G80
G0 Z5
(End of program)
M5
G0 Z30
M30
