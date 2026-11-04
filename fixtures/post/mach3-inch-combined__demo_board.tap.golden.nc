(TraceMill G-code - mach3 post)
(Project: demo board)
(File: demo_board.tap)
(Machine: Mach3 router [inch])
(Date: 2026-01-02)
(Units: inch)
(Estimated time: 2 min 07 s)
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
G20
G90 G94 G17 G40 G49 G80
G91.1
G0 Z0.1969
(Tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1" must be loaded and Z zeroed on the copper before starting)
(Step: Isolation [top] [isolate, top side] with tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
M3 S12000
G4 P2
G0 X0.3937 Y0.3937
G0 Z0.0787
G1 Z-0.002 F2.36
G1 X0.7874 F11.81
G3 X0.9843 Y0.5906 I0 J0.1969
G1 Y0.9843
G2 X0.5906 Y0.9843 I-0.1969 J0
G1 X0.3937 Y0.3937
G0 Z0.0787
G0 X1.5748
G1 Z-0.002 F2.36
G3 X1.5748 Y0.3937 I-0.1181 J0 F11.81
G0 Z0.0787
G0 Z0.1969
(TOOL CHANGE to #2 0.8 mm drill)
M5
G0 Z1.1811
(After inserting the tool, re-zero Z on the copper surface)
M0 (Insert tool #2 0.8 mm drill, then press cycle start)
(Step: Drill 0.8 mm [drill, top side] with tool #2 0.8 mm drill)
M3 S10000
G4 P2
G0 Z0.0787
G98 G83 X0.1969 Y0.1969 Z-0.0709 R0.0394 Q0.0236 F3.94
X0.5906 Y0.1969
G81 X0.9843 Y0.1969 Z-0.0709 R0.0394 F3.94
G80
G0 Z0.1969
(TOOL CHANGE to #3 1 mm flat end mill "1.0 mm end mill")
M5
G0 Z1.1811
(After inserting the tool, re-zero Z on the copper surface)
M0 (Insert tool #3 1 mm flat end mill "1.0 mm end mill", then press cycle start)
(Step: Hole mill 3 mm [holeMill, top side] with tool #3 1 mm flat end mill "1.0 mm end mill")
M3 S15000
G4 P2
G0 Z0.1969
G0 X1.2205 Y1.1811
G0 Z0.0394
G1 Z0 F1.97
G3 X1.2205 Y1.1811 Z-0.0236 I-0.0394 J0 F7.87
G3 X1.2205 Y1.1811 Z-0.0472 I-0.0394 J0
G3 X1.2205 Y1.1811 Z-0.0709 I-0.0394 J0
G3 X1.2205 Y1.1811 I-0.0394 J0
G1 X1.1811
G0 Z0.0787
G0 Z0.1969
(Step: Board cutout [cutout, top side] with tool #3 1 mm flat end mill "1.0 mm end mill")
G0 X-0.0197 Y-0.0197
G0 Z0.0787
G1 Z-0.0709 F1.97
G1 X1.9882 F7.87
G1 Y1.5945
G1 X-0.0197
G1 Y-0.0197
G0 Z0.0787
G0 Z0.1969
(==== BOARD FLIP: following operations are on the BOTTOM side ====)
M5
G0 Z1.1811
G0 X0 Y0
M0 (FLIP THE BOARD NOW around the X axis, re-seat on the alignment pins, re-zero Z, then press Cycle Start)
(TOOL CHANGE to #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
G0 Z1.1811
(After inserting the tool, re-zero Z on the copper surface)
M0 (Insert tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1", then press cycle start)
(Step: Isolation [bottom] [isolate, bottom side] with tool #1 30deg V-bit 0.1 mm tip "30deg V-bit 0.1")
M3 S12000
G4 P2
G0 Z0.1969
G0 X0.4724 Y0.4724
G0 Z0.0787
G1 Z-0.002 F2.36
G1 X1.1811 F11.81
G2 X1.378 Y0.6693 I0 J0.1969
G0 Z0.0787
G0 Z0.1969
(End of program)
M5
G0 Z1.1811
M30
