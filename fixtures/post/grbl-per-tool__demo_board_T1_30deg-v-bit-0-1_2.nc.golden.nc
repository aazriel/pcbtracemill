(TraceMill G-code - grbl post)
(Project: demo board)
(File: demo_board_T1_30deg-v-bit-0-1_2.nc)
(Machine: GRBL 3018)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 15 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: BOTTOM)
(Board must be FLIPPED around the X axis [bottom side up] before running this file)
(Tools:)
(#1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1" - 12000 rpm)
(Steps:)
(1. Isolation [bottom] [isolate, bottom, T1])
G21
G90 G94 G17
G0 Z5
(Tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1" must be loaded and Z zeroed on the copper before starting)
(Step: Isolation [bottom] [isolate, bottom side] with tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
M3 S10000
G4 P3
G0 X12 Y12
G0 Z2
G1 Z-0.05 F60
G1 X30 F300
G2 X35 Y17 I0 J5
G0 Z2
G0 Z5
(End of program)
M5
G0 Z30
M30
