(TraceMill auto-level probe program - mach3 - G31)
(Grid 3 x 2 = 6 points, X0..20 Y0..10, spacing 10 x 10 mm)
(Probe feed 50 mm/min, max depth Z-2, clearance Z2)
(SAFETY: clip the probe wire to the bit and the ground clip to the copper board)
(SAFETY: test continuity first - touch clip to bit and check the controller sees the probe)
(SAFETY: start with the bit ABOVE the board, spindle OFF)
(SAFETY: probe with a sturdy bit - flat end mill or steel pin - not a V-bit, a thin tip breaks)
(SETUP: zero X/Y as for milling and zero Z on the copper at the first point X0 Y0)
(This program does not change work offsets. Heights are relative to the first probed point.)
(After a bit change Z0 must be at the copper of the first point again.)
(TraceMill corrected files can find it with the probe - set Z only roughly then.)
(RESULTS: needs the TraceMill macros M401.m1s and M402.m1s in C:/Mach3/macros/<profile>/)
(Save them from the TraceMill probe dialog. M401 starts the file, M402 after every G31)
(waits for the machine to stop and writes the DRO X,Y,Z to C:/Mach3/TraceMill-probe.txt)
(Import that file. The Mach3 digitize file M40/M41 is not used: with many motion)
(controllers it records the target Z and old X/Y instead of where the probe stopped.)
(WARNING: Mach3 G31 does not stop with an error when nothing is touched - watch the first point.)
G21
G90 G94 G17
G91.1
G0 Z2
M401 (TraceMill: start a new results file)
G0 X0 Y0 (first point = height reference)
G31 Z-2 F50
M402 (TraceMill: write where the probe stopped)
G0 Z2
G0 X10 Y0
G31 Z-2 F50
M402 (TraceMill: write where the probe stopped)
G0 Z2
G0 X20 Y0
G31 Z-2 F50
M402 (TraceMill: write where the probe stopped)
G0 Z2
G0 X20 Y10
G31 Z-2 F50
M402 (TraceMill: write where the probe stopped)
G0 Z2
G0 X10 Y10
G31 Z-2 F50
M402 (TraceMill: write where the probe stopped)
G0 Z2
G0 X0 Y10
G31 Z-2 F50
M402 (TraceMill: write where the probe stopped)
G0 Z2
G0 X0 Y0
(Probing finished. Remove the probe clip before milling.)
M30
