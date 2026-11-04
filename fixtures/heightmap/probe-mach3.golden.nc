(TraceMill auto-level probe program - mach3 - G31)
(Grid 3 x 2 = 6 points, X0..20 Y0..10, spacing 10 x 10 mm)
(Probe feed 50 mm/min, max depth Z-2, clearance Z2)
(SAFETY: clip the probe wire to the bit and the ground clip to the copper board)
(SAFETY: test continuity first - touch clip to bit and check the controller sees the probe)
(SAFETY: start with the bit ABOVE the board, spindle OFF)
(SETUP: zero X/Y as for milling and zero Z on the copper at the first point X0 Y0)
(This program does not change work offsets. Heights are relative to the first probed point.)
(Do NOT re-zero Z between probing and milling.)
(RESULTS: M40 / M41 must exist as macros: M40.m1s containing OpenDigFile and M41.m1s CloseDigFile.)
(M40 asks for a file name, each G31 then appends X,Y,Z to it. Import that file.)
(Without the macros, remove M40/M41 and note #2000-#2002 X,Y,Z after every G31 manually.)
(WARNING: Mach3 G31 does not stop with an error when nothing is touched - watch the first point.)
G21
G90 G94 G17
G91.1
G0 Z2
M40 (open digitize file)
G0 X0 Y0 (first point = height reference)
G31 Z-2 F50
G0 Z2
G0 X10 Y0
G31 Z-2 F50
G0 Z2
G0 X20 Y0
G31 Z-2 F50
G0 Z2
G0 X20 Y10
G31 Z-2 F50
G0 Z2
G0 X10 Y10
G31 Z-2 F50
G0 Z2
G0 X0 Y10
G31 Z-2 F50
G0 Z2
M41 (close digitize file)
G0 X0 Y0
(Probing finished. Remove the probe clip before milling.)
M30
