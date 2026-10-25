# P3 status

P3 is an engineering fit prototype. Parts are printed and fit-checked. Motors are
not yet powered.

Current CAD SHA-256 starts `d3cd1724`. Reports under `exports/reports/` carry the
full hash. Results from another source revision are not evidence for this one.
The [verification record](p3-verification.md) lists the local checks: 29 tests,
16 interface probes, 47 printable parts, 17 sliced plates, dense gear/tilt sweeps,
cable checks and 69 whole-assembly poses.

Downloads: [p3.1 release](https://github.com/worxbend/camx-pro/releases/tag/p3.1),
with archives of the 17 print plates, the 47 individual part 3MFs, the printed
substitutes and the full prototype package.

## Implemented

- Modular build123d geometry, configurable dimensions, parameter provenance.
- Coaxial 4:1 planetary actuator: four captured planet bearings, located
  sleeves, independent output bearings, floating sun-bearing cartridge.
- U-yoke with concealed 2:1 belt drive, adjustable motor mount, recessed
  fasteners, captured-nut shaft clamps and a defined trunnion thrust stack.
- Constant-wall bonnet, reinforced bosses, retained electronics, service hatch
  receivers, seam-open USB cable entry.
- Base cable-guide columns with a Ø14 mm root flare and gussets, trimmed clear
  of the electronics trays and lid bosses.
- Separate pan cable layers, removable guides, split rotating ceilings,
  fixed/moving clamps. Ideal cable paths checked against actual CAD meshes.
- A1 mini plate layouts, STEP/STL/3MF exports, drawings, renders, BOM,
  assembly guide and an inspection viewer.
- Solid, mesh, parameter, interface, motion, cable, layer, slicing and archive
  checks. Packaging refuses missing, failed or stale reports.
- Optional [printed substitutes](printed-hardware.md) for bearings, shafts and belt drive.
- ESP32-WROOM stepper firmware for 4:1 pan and 2:1 tilt: browser remote,
  authenticated HTTP/serial commands, jerk-limited synchronized motion, named
  presets, calibration, manual reference, motion leases and latched faults.
  See the [firmware guide](../../firmware/README.md) and
  [software verification](../../firmware/docs/verification.md).

## Remaining physical qualification

See the [production-readiness review](../../docs/production-readiness.md) for
software findings and powered commissioning checks.

| Area | Required evidence |
|---|---|
| Hardware fit | Actual C200 folded envelope, plug/boot, shafts, populated boards, bearing races and screw heads |
| Printing | Installed nozzle, PLA fit coupons, nut loading, clamp grip, support removal and layer strength |
| Actuator | Measured endplay, backlash, bearing drag, gear engagement and belt pretension |
| Harness | Actual fixed tails and tilt service loop; manual full-travel bend, drag and strain-relief trials |
| Motion | Loaded running torque, step loss, repeatability and achievable speed |
| Thermal | Motor and PLA temperatures, creep and duty-cycle limits |
| Control | Bench qualification of manual reference, directions, limits, watchdogs and GPIO timing before full travel |

Material: PLA. Camera: Anker PowerConf C200. Nozzle: 0.4 mm assumed. Anker
publishes approximate dimensions and mass, but no interface drawing; see
[manufacturer data](c200-manufacturer-data.md). Final mounting dimensions need the actual unit.

## Limits

- CAD renders use simplified hardware envelopes.
- Electrical measurements, motor motion and flashing are unverified.
- Finite sampling does not prove continuous clearance. Flexible cables are not simulated.
- The viewer has build and model checks. The firmware remote was tested in local
  Chromium against the portable C++ controller. Real ESP32 networking is untested.
- Later work: automatic sensor homing, optional host-side automation,
  photorealistic product imagery.
