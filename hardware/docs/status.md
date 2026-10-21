# P3 engineering fit prototype

P3 implements CAD corrections for all sixteen findings in the historical
[P2 audit](preprint-audit.md). The [closure register](p3-design-closure.md)
identifies each change and its verification. Machine-readable reports under
`exports/reports/` carry the CAD source SHA-256; results from another source
revision are not release evidence.

The [P3 verification report](p3-verification.md) records the completed local
checks: 21 tests, 16 interface probes, 47 printable parts, 17 sliced plates,
dense gear/tilt sweeps, cable checks and 69 whole-assembly poses.

## Implemented

- Modular build123d geometry, configurable dimensions and parameter provenance.
- Coaxial 4:1 planetary actuator with four captured planet bearings, located
  sleeves, independent output bearings and a floating sun-bearing cartridge.
- U-yoke with concealed 2:1 belt drive, adjustable motor mount, recessed
  fasteners, captured-nut shaft clamps and a defined trunnion thrust stack.
- Constant-wall bonnet, reinforced bosses, retained electronics, service hatch
  receivers and a seam-open USB cable entry.
- Separate pan cable layers, removable guides, split rotating ceilings and
  fixed/moving clamps; ideal cable paths checked against actual CAD meshes.
- A1 mini part layouts, STEP/STL/3MF exports, drawings, CAD renders, BOM,
  assembly instructions and a local inspection viewer.
- Solid, mesh, parameter, interface, motion, cable, layer, slicing and archive
  checks. Package creation refuses missing, failed or stale prerequisite reports.
- ESP32-WROOM stepper firmware for the 4:1 pan and 2:1 tilt reductions, a browser
  remote, authenticated HTTP/serial commands, jerk-limited synchronized pan/tilt
  motion, named presets, calibration, manual reference, motion leases and latched
  faults. See the [firmware guide](../../firmware/README.md)
  and [software verification](../../firmware/docs/verification.md).

## Remaining physical qualification

On 21 October 2026 the owner confirmed that all parts are printed and fit.
Motors have not yet been tested. See the [production-readiness review](../../docs/production-readiness.md)
for the software findings and the remaining powered commissioning checks.

| Area | Required evidence |
|---|---|
| Hardware fit | Actual C200 folded envelope, plug/boot, shafts, populated boards, bearing races and screw heads |
| Printing | Installed nozzle, PLA fit coupons, nut loading, clamp grip, support removal and layer strength |
| Actuator | Measured endplay, backlash, bearing drag, gear engagement and belt pretension |
| Harness | Actual fixed tails and tilt service loop; manual full-travel bend, drag and strain-relief trials |
| Motion | Loaded running torque, step loss, repeatability and achievable speed |
| Thermal | Motor and PLA temperatures, creep and duty-cycle limits |
| Control | Bench qualification of manual reference, directions, limits, watchdogs and GPIO timing before full travel |

The owner confirmed PLA and the Anker PowerConf C200. The nozzle is assumed
to be 0.4 mm from the “4mm” reply. Anker publishes approximate dimensions and
mass, but no interface drawing: see [manufacturer data](c200-manufacturer-data.md).
Final mounting dimensions still require the actual unit.

CAD renders use simplified hardware envelopes. Printing and fit are owner-confirmed;
electrical measurements, motor motion and flashing remain unverified. Finite sampling
does not prove continuous clearance; flexible-cable mechanics are not simulated.
The CAD viewer and its model have local build/model checks; its historical
interactive review had no connected browser. The new firmware remote was tested
in local Chromium against the portable C++ controller. Actual ESP32 networking,
electrical behavior and motor motion remain untested. Automatic sensor homing,
optional host-side automation and photorealistic desktop imagery remain later work.
