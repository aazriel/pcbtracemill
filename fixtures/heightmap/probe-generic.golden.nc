(TraceMill auto-level probe program - generic - G31)
(Grid 3 x 2 = 6 points, X0..20 Y0..10, spacing 10 x 10 mm)
(Probe feed 50 mm/min, max depth Z-2, lift 0.5 mm above each touch)
(The bit lifts only a little above each touch - if a point does NOT touch, stop the machine.)
(SAFETY: clip the probe wire to the bit and the ground clip to the copper board)
(SAFETY: test continuity first - touch clip to bit and check the controller sees the probe)
(SAFETY: start with the bit ABOVE the board, spindle OFF)
(SAFETY: probe with a sturdy bit - flat end mill or steel pin - not a V-bit, a thin tip breaks)
(SETUP: zero X/Y as for milling and zero Z on the copper at the first point X0 Y0)
(This program does not change work offsets. Heights are relative to the first probed point.)
(After a bit change Z0 must be at the copper of the first point again.)
(TraceMill corrected files can find it with the probe - set Z only roughly then.)
(RESULTS: collect the probed X Y Z of every G31 from your controller and import them as CSV.)
G21
G90 G94 G17
G0 Z2
G0 X0 Y0 (first point = height reference)
G31 Z-2 F50
G91
G0 Z0.5
G90
G0 X10 Y0
G31 Z-2 F50
G91
G0 Z0.5
G90
G0 X20 Y0
G31 Z-2 F50
G91
G0 Z0.5
G90
G0 X20 Y10
G31 Z-2 F50
G91
G0 Z0.5
G90
G0 X10 Y10
G31 Z-2 F50
G91
G0 Z0.5
G90
G0 X0 Y10
G31 Z-2 F50
G0 Z2
G0 X0 Y0
(Probing finished. Remove the probe clip before milling.)
M30
