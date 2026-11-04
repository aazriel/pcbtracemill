(TraceMill G-code - mach3 post)
(Project: demo board)
(File: demo_board_01_isolation-top.tap)
(Machine: Mach3 router)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 26 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: TOP)
(Tools:)
(#1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1" - 12000 rpm)
(Steps:)
(1. Isolation [top] [isolate, top, T1])
G21
G90 G94 G17 G40 G49 G80
G91.1
G0 Z5
G0 Z30
T1 M6 (Load tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
G43 H1
(Step: Isolation [top] [isolate, top side] with tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
M3 S12000
G4 P2
G0 Z5
G0 X10 Y10
G0 Z2
G1 Z-0.05 F60
G1 X20 F300
G3 X25 Y15 I0 J5
G1 Y25
G2 X15 Y25 I-5 J0
G1 X10 Y10
G0 Z2
G0 X40
G1 Z-0.05 F60
G3 X40 Y10 I-3 J0 F300
G0 Z2
G0 Z5
(End of program)
M5
G0 Z30
M30
