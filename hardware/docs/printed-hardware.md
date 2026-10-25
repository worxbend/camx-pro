# Printed hardware substitutes

Optional printed replacements for the purchased bearings, steel shafts, sleeves,
spacers, collar, pulleys and belt in the [BOM](bom.csv). Each substitute keeps the
envelope and datum of the part it replaces, so every P3 printed part is unchanged.
The geometry lives in `printed_hardware/`, outside `cad/`, so the P3 source
fingerprint and its reports stay valid.

```sh
cd hardware
.venv/bin/python -m printed_hardware.export      # exports/printed-hardware/
.venv/bin/python -m pytest -q tests/test_printed_hardware.py
```

The export writes per-part STL/3MF/STEP in print orientation, one plate set per
material and `manifest.json` with quantities. Clearances and roller counts are in
`printed_hardware/parameters.json`.

## Parts

| Part | Qty | Replaces | Material | Construction |
| --- | --- | --- | --- | --- |
| `output_bearing_6809` | 2 | 6809, 45×58×7 | PETG or PLA | Print-in-place: two races and 30 uncaged bicone rollers |
| `small_bearing_688` | 7 | 688, 8×16×5 | PETG or PLA | Print-in-place plain bearing: ridged sleeve in a grooved ring |
| `planet_pin_sleeve` | 4 | steel sleeve 8×3.2×14.5 | PETG-CF | Ø7.95 tube, Ø3.4 bore for the M3 carrier screw |
| `planet_shim_lower` / `_upper` | 4 + 4 | 0.2 / 6.7 mm shims | PETG-CF | Rings; the lower shim is one 0.2 mm layer |
| `output_inner_spacer`, `output_shim_*` | 1, 2 each | spacer and adjustment shims | PETG-CF | Ø48×Ø45.15 rings; shims 0.2/0.4/0.6 mm |
| `tilt_trunnion` | 2 | steel Ø8×28 shaft | PETG-CF | Ø7.9 with a 0.4 mm flat; prints lying on the flat |
| `tilt_inner_spacer` / `_outer_spacer` | 2 + 2 | 2.1 / 3.9 mm spacers | PETG-CF | Ø11×Ø8.15 rings |
| `tilt_passive_collar` | 1 | shaft collar | PETG-CF | Ø16×5, D bore, M2 grub screw in a square-nut slot |
| `tilt_drive_pulley_20t` | 1 | 20T GT2, 5 mm bore | PETG-CF | Double-flat motor bore, M2 grub screw at X43.5 |
| `tilt_axis_pulley_40t` | 1 | 40T GT2, 8 mm bore | PETG-CF | D bore on the trunnion flat, M2 grub screw |
| `tilt_belt_tpu`, `tilt_belt_tpu_1p6mm_short` | 1 each | 160×4 mm GT2 belt | TPU 95A | 80-tooth ring printed flat, teeth inward, 1.2 mm back |
| `clearance_coupon` | 1 | — | PETG or PLA | Five 688 substitutes at 0.20–0.40 mm; notches count 1–5 |

Extra hardware: three M2 grub screws (about M2×4) with M2 square nuts for the
pulleys and collar. Pan-head screws do not fit: the 20T hub runs in a Ø12.8 bore.

## Printing

1. Print the clearance coupon in the bearing material first. Break each bearing
   free by hand. Set `clearance.print_in_place` to the tightest value that turns
   freely and re-export. Printer, material and slicer settings decide this value,
   and it controls the radial play of every printed bearing (0.3 mm by default).
2. Print one `output_bearing_6809` and check it against the housing pocket and
   the Ø44.85 journal before printing the second.
3. Bearings: 0.2 mm layers, no supports, no brim inside the races, seams aligned
   away from the running gap. Turn them by hand until smooth; a little PTFE dry
   lubricant helps. Avoid CF-filled filament here: it wears the running faces.
4. Shafts, pulleys, sleeves and spacers: PETG-CF, 100% infill for shafts and
   pulleys. Pulleys print belt-flange down. The hub-side lip is a 45° cone in the
   1 mm between the teeth and the belt edge, so no supports are needed.
5. Belt: TPU 95A, 100% infill, slow, without retraction-heavy settings. Print both
   lengths. Fit the nominal belt first and use the 1.6 mm shorter (1%) belt if the
   ±1 mm motor slot cannot tension it.

## Assembly differences

- Fit printed bearings exactly as the steel ones in the [assembly sequence](assembly.md).
  They carry axial load through the interlocking ridge, so the spacer stacks are unchanged.
- Turn each trunnion so its flat faces the 40T pulley and collar set screws. Its
  bore clamps in the cradle exactly as the steel shaft did.
- The 20T pulley has no tooth-to-flat ambiguity: its bore has both motor shaft flats.
  Rotate the motor until the grub screw lines up with the yoke service bore.

## Verification

Checked in `tests/test_printed_hardware.py` and against the P3 assembly: valid
solids; 0.3 mm running gaps; rollers and sleeves locked axially (a 0.5 mm lift
collides); race faces inside the P3 Ø48/Ø55 and Ø11/Ø13.5 spacer lands; pulley
bounds identical to the P3 pulley envelopes; no interference between the printed
pulleys and the yoke, rear cover, side cover, tilt retainer or cradle; belt pitch
length, tooth/groove clearance and wrapped back inside the P3 belt envelope.

Not verified: slicing in Bambu Studio, print-in-place release, bearing friction
and wear, radial play effect on planetary backlash, PETG-CF shaft stiffness under
load, TPU belt stretch and tooth jumping, and temperature creep near the motors.
These parts trade the purchased parts' precision for availability. Expect more
backlash and friction than with steel bearings and a fibre-reinforced belt.
