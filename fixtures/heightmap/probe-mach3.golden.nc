(TraceMill auto-level probe program - mach3 - G31)
(Grid 3 x 2 = 6 points, X0..20 Y0..10, spacing 10 x 10 mm)
(Probe feed 50 mm/min, max depth Z-2, clearance Z2)
(SAFETY: clip the probe wire to the bit and the ground clip to the copper board)
(SAFETY: test continuity first - touch clip to bit and check the controller sees the probe)
(SAFETY: start with the bit ABOVE the board, spindle OFF)
(SAFETY: probe with a sturdy bit - flat end mill or steel pin - not a V-bit, a thin tip breaks)
(SETUP: zero X/Y as for milling and zero Z on the copper at the first point X0 Y0)
(Work offsets stay as they are - G92 is used for a moment at each point and put back. Heights are relative to point 1.)
(After a bit change Z0 must be at the copper of the first point again.)
(TraceMill corrected files can find it with the probe - set Z only roughly then.)
(RESULTS: no file. Every height is kept in Mach3 variables)
(#500-#505 until Mach3 is closed.)
(The corrected TraceMill files read them - run them in the same Mach3 session.)
(Do not close Mach3 between probing and milling, or probe again.)
(Each point: fast touch, up 0.25 mm, slow touch at F10, height read with G92 / #5213.)
(WARNING: if nothing is touched Mach3 signals an error and stops - check the clip, then restart.)
G21
G90 G94 G17
G91.1
G0 Z2
#499=0 (heights not complete yet)
#498=#5213 (keep the G92 Z offset that is active now)
G0 X0 Y0 (first point = height reference)
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#500=[#5213-#498]
G92 Z#500
G0 Z2
G0 X10 Y0
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#501=[#5213-#498]
G92 Z#501
G0 Z2
G0 X20 Y0
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#502=[#5213-#498]
G92 Z#502
G0 Z2
G0 X20 Y10
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#505=[#5213-#498]
G92 Z#505
G0 Z2
G0 X10 Y10
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#504=[#5213-#498]
G92 Z#504
G0 Z2
G0 X0 Y10
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#503=[#5213-#498]
G92 Z#503
G0 Z2
(Point 1 again - the height reference, measured last)
G0 X0 Y0
G31 Z-2 F50
G91
G0 Z0.25
G90
G31 Z-2 F10
G92 Z0
#497=[#5213-#498]
G92 Z#497
G0 Z2
(Make every height relative to point 1)
#501=[#501-#497]
#502=[#502-#497]
#503=[#503-#497]
#504=[#504-#497]
#505=[#505-#497]
#500=0
#499=1 (heights complete)
G0 X0 Y0
(Probing finished. Remove the probe clip before milling.)
M30
