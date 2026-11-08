(PCB TraceMill G-code - grbl post)
(Project: demo board)
(File: demo_board_T2_0-8-mm-drill.nc)
(Machine: GRBL 3018)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 25 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: TOP)
(Tools:)
(#2 0.8 mm drill - 10000 rpm)
(Steps:)
(1. Drill 0.8 mm [drill, top, T2])
G21
G90 G94 G17
G0 Z5
(Tool #2 0.8 mm drill must be loaded and Z zeroed on the copper before starting)
(Step: Drill 0.8 mm [drill, top side] with tool #2 0.8 mm drill)
M3 S10000
G4 P3
G0 X5 Y5
G0 Z1
G1 Z-0.6 F100
G0 Z1
G1 Z-1.2
G0 Z1
G1 Z-1.8
G0 Z1
G0 Z2
G0 X15
G0 Z1
G1 Z-0.6
G0 Z1
G1 Z-1.2
G0 Z1
G1 Z-1.8
G0 Z1
G0 Z2
G0 X25
G0 Z1
G1 Z-1.8
G0 Z1
G0 Z2
G0 Z5
(End of program)
M5
G0 Z30
M30
