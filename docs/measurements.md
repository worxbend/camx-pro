# Hardware measurement sheet

## Confirmed and inferred

The owner confirmed **Bambu Lab A1 mini**. Its manufacturer specifies a
[180 × 180 × 180 mm build volume](https://cdn1.bambulab.com/documentation/quick-start-f507128172bdf/Quick%20start%20guide%20-%20A1%20mini-EN.pdf).
The owner selected PLA; 0.4 mm is assumed from the stated “4mm nozzle”. The exact nozzle and material profile need confirmation.

The photos show two motors marked 28BYJ-48 / 5 V, an ESP32 development board,
one front-facing ULN2003-type board, another board seen from the rear and a small
connector breakout. The latter board identities and connector pinouts require
inspection. Capacitors and the custom integration PCB are owner-reported.

The owner identified the webcam as the **Anker PowerConf C200**. Manufacturer data is recorded in [c200-manufacturer-data.md](c200-manufacturer-data.md). No scale or orthographic measurement reference is present, so photo
pixels are not used as exact dimensions. The marketing camera image establishes
styling only.

## Measure before full-size printing

Record caliper measurements in `cad/parameters.json` and matching provenance in
`cad/parameter_sources.json`. Include instrument, date and uncertainty.

| Item | Provisional CAD assumption | Measurement required |
|---|---|---|
| Webcam complete envelope | 52 × 55 × 55 mm clearance envelope | Width, depth, height with folded clip; lens/mic/shutter keepouts |
| Webcam mass and balance | 83 g manufacturer mass, CG 2 mm provisional | Mass with moving cable; fore/aft and vertical balance point |
| Camera attachment | Slotted 6.8 mm clearance | Confirm factory tripod thread, location and safe engagement |
| Rear USB plug | 12 × 25 × 8 mm | Actual connector, boot, insertion/removal and cable exit direction |
| Cable | 4 mm diameter, 20 mm bend radius | Supplier bend limit, drag torque and slack through both axes |
| Each motor | Ø28 × 20 mm body | Measure separately; labels differ |
| Motor mounting | 35 mm ear pitch, 8 mm shaft offset | Hole pitch/diameter, ears, lead block and shaft-face datum |
| Motor shaft | Ø5 mm, 3 mm across flats, 9 mm projection | Exact flats, usable engagement and rotational play |
| ESP32 | 58 × 29 × 14 mm | Headers, antenna keepout, connector and mounting dimensions |
| Each driver | 35 × 32 × 14 mm | Terminal blocks, connectors, holes and orientation |
| Integration PCB | 38 × 24 × 10 mm | Actual populated envelope and mounting scheme |
| Power breakout | 12 × 18 × 5 mm | Connector opening, pin labels, CC termination and current rating |
| Bearings / shafts | See BOM | Measure received bearing OD/ID/width and shaft diameter |
| Filament | PLA owner-selected | Actual material, shrinkage, bearing-hole coupon results |

The folded clip is included in the full camera envelope. `clip_depth` is
recorded for future detailed hardware modeling; it does not currently alter
the envelope. `bend_radius`, mass, CG and speed parameters are engineering
inputs, not automatically validated mechanical properties.

## Bench measurements

1. Disconnect the real webcam; use a supported dummy load for first motion.
2. Measure output steps per revolution for each motor, unloaded and then loaded.
3. Measure backlash after reversals and required cable torque at the extremes.
4. Establish reliable running torque at the selected speed and supply voltage.
5. Record supply sag, driver/motor temperatures and ESP32 stability with both
   axes energized. Confirm the maximum permitted holding duration.
6. Update calibration and limits only after the entire harness passes repeated
   pan/tilt sweeps without rubbing, tension or connector movement.

## Tilt belt-drive fit gate

Measure both pulley bores, hub lengths, flange diameters and set-screw positions;
confirm matching tooth profile and 4 mm belt width. Check shaft engagement at the
58 mm belt plane and the nominal 49.59 mm center distance. Record low-tension
running behavior and gearbox radial-load effects before loaded movement.

## Planetary fit gate

Check 6809 and 688 bearings, all four steel planet sleeves and shim stacks,
M3 carrier screw heads/nuts, long housing screws and the sun's M2 square nut and
grub screw. Record output endplay, carrier parallelism, hand-turned mesh behavior
and the two harness loops outside the gearbox before any powered tests.
