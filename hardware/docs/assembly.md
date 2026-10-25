# P3 printing and assembly

## Print and fit sequence

Use the A1 mini, PLA and a 0.4 mm nozzle (assumed; confirm the installed one). Import the geometry-only plate 3MFs into Bambu Studio with the actual PLA profile. Start with 0.2 mm layers, four walls and 30% infill; inspect every plate and its supports. The generic local slicer audit is not a machine profile.

Run `tools.prepare_print_plates` after CAD export. The raised USB power tray has a separate plate, and the small clamp plate uses 20 mm spacing because generated supports reached neighboring parts in the original packing. Preserve that separation when importing into Bambu Studio.

Print the fit coupon first. It checks bearing pockets, the output journal, motor bore and screw-size ladder. Then trial a planet/cap, sleeve pilot and cradle clamp. Do not force steel shafts or bearings into PLA. Measure the populated boards before printing their trays.

Planet caps print inverted, nose upward. Side covers and small clamp caps print on their selected flat faces. The housing prints inverted. The upper carrier needs removable support under its locating bosses/plate. The platform's integral lower cable shelf needs accessible support; keep its channels smooth. Fixed cable guides are separate tray/shelf/roof parts; the rotating ceiling is two semicircular halves. Remove all support from cable-contact surfaces. Layer/slicer reports identify overhangs but cannot prove support removal quality.

## Actuator and electronics

1. Deburr parts; check seven 688 and two 6809 bearings against their actual race widths. Confirm sleeve lengths and screw envelopes in the BOM. Install the pan motor on its ear columns using M3 heads no larger than Ø5.5×1.6 mm.
2. Fit the sun's square nut/grub screw before surrounding it with the ring. Clamp the motor flat without pushing the shaft axially. Install the fixed ring on the base columns.
3. Load four M1.6 square nuts (≤3.2×3.2×1.3 mm) through each planet's inner radial channels. Seat its 688 outer race, fit the cap and four M1.6 screws. The cap nose retains the nuts and outer race. Verify free rotation and approximately 0.4 mm outer-race axial allowance; it must not rest on a carrier plate.
4. Fit lower-carrier M3 nuts, four 14.5 mm steel sleeves, 0.2 mm lower inner-race shims, planet assemblies and 6.7 mm upper inner-race spacers. Close the upper carrier with nominal M3×20 screws. Match gear phases before placing the carrier into the ring/sun mesh.
5. Fit the floating sun cartridge, bearing, sun journal cap and its M2 screw, then the cartridge retainer. The sun bearing inner race is retained on the sun; the cartridge must not take output thrust. Use the recessed cartridge screw wells.
6. Install the output cage, lower 6809, 5 mm inner/outer spacers, upper 6809 and recessed retainer. Fit nominal M3×45 cage/ring screws into the base. Check the actual screw-tip depth. The platform completes the inner-race thrust stack later; final total endplay is nominally 0.2 mm. Select measured shims; never tighten away binding.
7. Fasten horizontal PCB trays and capacitor cup. Place insulating pads/ties on verified bare PCB edges. Fit the USB-C board's raised carrier and check connector insertion force. Keep the ESP32 antenna clear and motor supply current off its regulator.

## Yoke, cables and covers

8. Fasten the U-frame to the platform from below. Fit the skirt. Keep the camera/cradle removable for driver access. Dry-fit both rotating ceiling halves radially around the platform neck and verify the four diagonal driver paths. Leave the halves off until cables are laid; install them before lowering the upper assembly into the fixed guide opening. This avoids trapping a closed ring between the platform flanges.
9. Install tilt bearings, recessed retainers, inner spacers, both 28 mm shafts, cradle, outer spacers, driven pulley and passive collar. Retain 0.2 mm nominal total axial allowance. Tighten captured-nut clamps only after a PLA coupon confirms grip without cracking.
   The cradle's rear shelf stops 1 mm short of the provisional camera envelope to clear the concealed motor. Retain the camera through its verified factory mounting interface; the shelf alone is not its restraint. The rear cover includes clearance for the cradle's full swept radius.
10. Fit the motor/20T pulley, 40T axis pulley and matched 160 mm belt. The belt plane is X58 mm. Install the rear-cover nuts before closing it; nominal M3×25 ear bolts pass through the yoke. Adjust within ±1 mm with low belt tension; verify full-motion clearance before fitting the side caps.
11. Assemble the fixed cable tray, upper shelf and roof using four corner screws outside the cable track. Lay the cables into the open guides before fitting roofs. Stage the upper assembly on a support while feeding its inner cable arc; fit its ceiling halves while their radial insertion paths remain open. Tighten the fixed roof screws before the bonnet covers their corner access. Do not pull a connector through a narrow running gap. Motor cable occupies Z75, USB Z81. Use the routing drawing and clamp datums; do not substitute an arbitrary tight coil. The two moving risers pass through the platform window into the passive arm. Thin compliant liners provide grip in the split clamps without crushing cables.
12. Complete stationary tails and the camera tilt service loop with the actual cables, retaining their specified bend radius. These tails require a manual sweep. Lay the USB cable into the bonnet's seam-open entry and fit its split inserts; the intact plug can be rotated with its 8 mm dimension across the opening. Never cut the cable to install it.
13. Fit the bonnet from above before securing the upper platform to its journal through the cardinal driver holes. Fit the cradle/camera only after empty-mechanism and supported dummy-load checks. Verify the factory tripod thread and safe depth; never drill the webcam or obscure its microphones, vents, lens or privacy switch.

## Commissioning and service

Start with restricted travel and one motor at a time. Measure backlash, repeatability, cable drag, coil temperature, PLA temperature and supply droop. No motion firmware or homing mechanism is commissioned by this CAD package. Keep open-loop full travel disabled until a repeatable reference and limits are implemented.

For service, disconnect power and support the upper assembly. Remove the cradle as required for the cardinal platform screws, release the cable clamps, then remove the upper assembly and bonnet. The two-piece rotating ceiling can be removed radially; fixed roofs lift off after their corner screws are removed. See the [physical release gates](p3-verification.md#physical-release-gates).
