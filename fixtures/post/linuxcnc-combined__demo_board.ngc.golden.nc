%
(PCB TraceMill G-code - linuxcnc post)
(Project: demo board)
(File: demo_board.ngc)
(Machine: LinuxCNC mill)
(Date: 2026-01-02)
(Units: mm)
(Estimated time: 2 min 43 s)
(Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface)
(Side: TOP then BOTTOM)
(Tools:)
(#1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1" - 12000 rpm)
(#2 0.8 mm drill - 10000 rpm)
(#3 1 mm flat end mill "1.0 mm end mill" - 15000 rpm)
(Steps:)
(1. Isolation [top] [isolate, top, T1])
(2. Drill 0.8 mm [drill, top, T2])
(3. Hole mill 3 mm [holeMill, top, T3])
(4. Board cutout [cutout, top, T3])
(5. Isolation [bottom] [isolate, bottom, T1])
G21
G90 G94 G17 G40 G49 G80
G91.1
G64 P0.01
G0 Z5
G0 Z30
T1 M6 (Load tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
G43 H1
(Step: Isolation [top] [isolate, top side] with tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
M3 S12000
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
(TOOL CHANGE to #2 0.8 mm drill)
M5
G0 Z30
T2 M6 (Load tool #2 0.8 mm drill)
G43 H2
(Step: Drill 0.8 mm [drill, top side] with tool #2 0.8 mm drill)
M3 S10000
G0 Z2
G98 G83 X5 Y5 Z-1.8 R1 Q0.6 F100
X15 Y5
G81 X25 Y5 Z-1.8 R1 F100
G80
G0 Z5
(TOOL CHANGE to #3 1 mm flat end mill "1.0 mm end mill")
M5
G0 Z30
T3 M6 (Load tool #3 1 mm flat end mill "1.0 mm end mill")
G43 H3
(Step: Hole mill 3 mm [holeMill, top side] with tool #3 1 mm flat end mill "1.0 mm end mill")
M3 S15000
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
(==== BOARD FLIP: following operations are on the BOTTOM side ====)
M5
G0 Z30
G0 X0 Y0
M0 (FLIP THE BOARD NOW around the X axis, re-seat on the alignment pins, re-zero Z, then press Cycle Start)
(TOOL CHANGE to #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
G0 Z30
T1 M6 (Load tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
G43 H1
(Step: Isolation [bottom] [isolate, bottom side] with tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
M3 S12000
G0 Z5
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
M2
%
