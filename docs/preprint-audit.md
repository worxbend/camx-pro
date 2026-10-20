> Historical P2 audit. P3 corrections and current validation are documented in [p3-design-closure.md](p3-design-closure.md). P2 exports are retained in the local ignored baseline archive; the commands and coordinates below describe that earlier revision.

# P2 Pre-print Audit

**Decision: HOLD — do not print the complete assembly yet.**

The local checks found **16 design and qualification gaps**, including assembly
blockers. The P2 solids, exports and nominal kinematics are valid, but the current
mechanism cannot yet be treated as a manufacturable, functional assembly.
The accepted external design and CAD geometry were preserved during this audit.

Audit date: **2026-10-20**. Model: **P2**, Bambu Lab A1 mini, 180 mm cubed.
CAD source SHA-256:
`203024e8a14433d77fe49b688e0263fff8f9e55645a4658172ca22769582e16c`.
Millimeters are used unless stated otherwise. PETG, 0.4 mm nozzle and 0.2 mm
layers remain provisional; only the printer model was confirmed by the owner.

## Checks completed

| Check | Result and scope |
|---|---|
| Python tests and dependencies | **16 passed** (11 existing + 5 audit tests), 14 warnings, 23.28 s. Audit tests cover layer growth, floating islands and extrusion-bound parsing. `pip check` passed. |
| B-rep/export validation | 28 printed parts are connected, valid solids; STL meshes are watertight; individual STEP round trips passed. |
| 3MF content and placement | All 28 individual build meshes checked for winding, positive volume, size and bottom placement. All 11 plates fit; each part occurs exactly once, with 8 mm model placement margins and gaps. |
| Archive/source identity | 129 checksums match; ZIP CRC passes; archived CAD and manifest match the local model. |
| Existing full rigid-motion report | Source hash matches: 69 poses, 56,083 evaluated pair checks, 96,476 reused equivalent checks, no overlap above 0.05 mm³. This prior result was verified, not rerun. |
| Additional tilt sweep | **41,866 pair checks**, every 1° from −30° to +90°; no nominal solid overlap. Includes both driven groups against pan-group components and each other. |
| Additional planetary sweep | **11,528 profile-pair checks**, carrier 0–360° in 0.25° increments; no nominal tooth overlap. Smallest sampled profile gap 0.1393 mm; adjacent tip-circle gap 7.8553 mm. |
| Continuous base-separation bound | AABB-based radial bounds keep the modeled tilted bodies above Z77.056 for every tilt angle; bonnet top is Z65.5. This excludes contact with the base for these bodies, not cables or added hardware. |
| Print-layer screening | **2,204 sections** across 28 actual STL print orientations; no section errors or newly floating islands. Overhangs require support/bridge assessment. |
| Slicer dry run | **11/11 plates sliced**, PrusaSlicer 2.9.4, supports and 3 mm brim enabled. No warning/error text in logs. Positive-extrusion path centers stay inside the bed; smallest edge margin is 2.887 mm. |
| Viewer assets/build | 67 components; pivots, combined transforms, 2:1 tilt drive and four planet orbits verified. Production build passed; only a large JavaScript-chunk advisory. No interactive browser test was available. |
| Assembly interfaces | **Blocked:** exact CAD probes substantiate omitted-fastener interference, mounting access, retention, stack and adjustment defects below. |
| Parameter/load scenarios | **Blocked/pending:** bearing-fit and wall parameters do not propagate; gravity and step-rate scenarios are calculated, but no motor load qualification is possible from the present data. |

The slicer used an isolated, generic **geometry-only** configuration, not a
Bambu Studio machine/material profile. Temporary G-code was deleted. No printer
was connected and no printer-ready G-code is supplied. Slicer estimates of time
and mass are not reliable procurement/printing estimates for this machine.

The independent review covered the planetary actuator, tilt assembly and
enclosure. Findings were reconciled against source and numerical CAD probes.
This was one review cycle of the unchanged P2 design, not a repaired-design review.

## Planetary actuator findings

| ID / priority | Evidence and consequence | Required correction |
|---|---|---|
| **P1 — high** | Base columns end at Z26.2 but the ring starts at 26.5; ring ends at 37 but cage posts start at 37.3. Two **0.3 mm gaps** exist in the bolted stack. Without interface shims, tightening settles the output support by 0.6 mm. Moving the carrier to meet its output bearing then produces **47.006 mm³** sun-retainer/bearing interference. Even without settlement, output and sun contacts both close after 0.2 mm, so the motor-bypassing load path is not established. | Use contacting datums or explicit interface shims. Define inner/outer bearing race stacks and endplay; give sun support sufficient axial freedom. Model the selected bearing race lands, not just overall rings. |
| **P2 — high; head envelopes conditional** | Motor ear to lower carrier: **0.5 mm** available for a head. Output retainer to platform: **0.3 mm**. Illustrative Ø5.5 × 1.5 mm M3 heads intersect the carrier by **23.758 mm³ each**; Ø3.5 × 1.2 mm M2 heads intersect the platform by **8.659 mm³ each**. Actual screws are unselected. | Select fasteners and recess or relocate their complete envelopes. Check stationary heads throughout carrier rotation and provide driver access. |
| **P3 — high** | Ø16.2 gear pockets clear Ø16 bearings. The upper retaining boss belongs to the carrier, not the gear. A planet can move down **0.499 mm** without touching its bearing/carriers; at −0.501 mm it contacts the lower carrier. | Capture the bearing outer race within each gear in both axial directions, or qualify an explicit interference fit. Preserve rotation clearance on both sides. |
| **P4 — medium** | Planet sleeves butt against flat carrier faces. M3 shanks in Ø3.4 carrier holes and Ø3.2 sleeve bores permit approximately **0.3 mm nominal lateral positioning freedom**, before print error. Nominal collision-free phasing does not cover this. | Add sleeve locating pilots/shoulders or a measured assembly fixture and a justified position tolerance; rerun mesh checks with the resulting tolerance range. |
| **P5 — medium** | Increasing `fit.bearing_diametral` by 0.2 mm changes **none of the actuator volumes**. Pockets remain hardcoded at Ø16.2/Ø58.2 while the coupon responds to the parameter. Bearing reference dimensions also do not consistently drive adjacent seats/journals. | Drive mating interfaces and coupons from common fit parameters; add parameter-response checks before using coupon results. |

Sources: [planetary.py](../cad/planetary.py), [assembly.py](../cad/assembly.py),
[enclosure.py](../cad/enclosure.py), [yoke.py](../cad/yoke.py).

## Tilt assembly findings

| ID / priority | Evidence and consequence | Required correction |
|---|---|---|
| **T1 — high** | Motor/rear-cover Ø3.4 slots stop inside the wings. A Ø3 shank path is fully blocked through **15 mm of drive-side wall** and **16 mm of passive-side wall**. No captured nut, insert or usable threaded receiver is provided. Removing the side caps does not expose a through path. | Extend access and provide actual head/receiver/tool geometry. Select lengths after defining the clamped stack. |
| **T2 — high** | Advertised ±1 mm motor adjustment conflicts with the fixed Ø12.6 relief around a Ø12 pulley hub. At ±0.5 mm, pulley/frame overlap is **7.038 mm³**; at ±1 mm, about **33.1–33.4 mm³**. Shared round cover holes also restrict nominal M3 shanks to ±0.2 mm. | Sweep the motor, hub, bolts and cover through usable adjustment. Relieve/slot all affected parts or separate cover fasteners from tension adjustment. |
| **T3 — high; head envelopes conditional** | Drive bearing-retainer face X42.3 and driven hub start X42.5 leave **0.2 mm**. Illustrative Ø3.8 × 2 mm heads overlap the hub by **1.051 mm³ each**. Plain holes contain no recess. | Specify and recess heads, move screw axes, or revise the pulley/bearing stack while retaining shaft engagement and belt alignment. |
| **T4 — high** | The cradle clamp boss is only 3 mm wide across a Ø2.6 M3 pilot: **0.2 mm ligaments** remain; nominal M3 major diameter leaves zero side ligament. The clearance half opens through the side, with no nut/insert or flat head seat. | Widen/reposition the clamp ears and provide a defined receiver and head seat. Check frame/tool clearances and print a representative clamp coupon. |
| **T5 — high qualification gap** | Plain Ø8 trunnions have no shoulders/collars or defined inner-race spacers. The moving stack can drift approximately **−0.2/+1.2 mm**, until pulley or cradle rubs stationary plastic. | Define positive axial retention and controlled bearing endplay. Verify retainer contact against actual outer races without rubbing shields/inner races. |

Sources: [gimbal.py](../cad/gimbal.py), [tilt_drive.py](../cad/tilt_drive.py),
[yoke.py](../cad/yoke.py), [assembly.py](../cad/assembly.py).
Straight shaft insertion cleared the sampled paths with caps/pulley removed.
Pulley set-screw access remains unresolved until actual hub/set-screw positions
are selected; the audit does not claim every possible tool route is blocked.

## Enclosure and integration findings

| ID / priority | Evidence and consequence | Required correction |
|---|---|---|
| **E1 — high; actual connector pending** | Rear camera outlet is a closed **Ø8 hole**. The reference USB plug has a **12 × 8 mm** cross-section and cannot pass it. Splitting only the internal clamp does not open the bonnet. | Use a seam-open entry/split insert or removable connector-sized panel. Verify both real cable ends while preserving the intact webcam cable. |
| **E2 — high** | Each bonnet boss overlaps the bare wall by only **8.441 mm³**. Attachment section is **2.371 mm²** near Z6.31, falls to **0.00749 mm²** near Z13.526, and is absent at Z14–18.29. A single connected solid hides this weak load path. | Add substantial webs/ribs or relocate the bosses; check screw loads and print orientation. |
| **E3 — high integration gap** | PCB posts end at Z6 but reference boards start at Z7; upright board clips/carriers are absent. The USB power board at Z27–32 has no connector-reaction support. Capacitor restraint and harness anchors are also unspecified. | Model measured, removable insulating carriers, connector support and strain relief, with solder/header/plug envelopes and service access. |
| **E4 — medium** | Service-hatch screw pilots are supported only by material between Z2 and Z3: **1 mm engagement**. No upward mounting bosses are modeled. | Provide suitable bosses/receivers and selected screws; recheck motor clearance. |
| **E5 — medium** | `base.wall = 2.8` does not control the loft. Raising it by 1 mm changes bonnet volume by **0**. Sampled radial wall falls to **1.923 mm** at Z45/225°. Loft overshoot yields **144.546 × 131.605 mm** footprint, larger than the nominal 142 × 126. | Make wall control effective and validate normal thickness/attachment strength. Use actual exported bounds. The radial samples are not a global minimum-thickness or strength proof. |
| **E6 — high qualification gap** | Claimed R49–61 cable space is not fully open: front/back inner wall at Z50 is **R56.230**, leaving only **7.23 mm** outside R49. No actual loop centerline, anchors, slack reserve or cable sweep is modeled. | Route and retain both bundles using measured cable/connector geometry, then verify bend radius and ±160° pan/−30° to +90° tilt. Narrow space does not by itself prove all possible 3D routes impossible. |

Source: [enclosure.py](../cad/enclosure.py). The passive arm's 10 × 14 mm lower
channel connects to its cavity and Ø18 port. The provisional plug cross-section
fits when oriented appropriately; turning the **25 mm-long** plug through the
route and maintaining the assumed **20 mm bend radius** remain unverified.

## Printing observations

Layer screening measures new area outside the previous layer expanded by
0.2 mm, corresponding to a 45° growth screen. It is not a bridge-length or
material-strength prediction.

| Part/orientation | Observation |
|---|---|
| Upper carrier | Starts on four separated bearing-boss rings; around print Z1.9 it adds **2,742 mm²** unsupported area. Supports or a revised orientation/design are needed. |
| Bonnet | Peak screened unsupported area **2,140 mm²** near print Z55.7. Inspect crown/boss supports and removal access. |
| Fixed ring | Tooth region adds **517 mm²** at print Z2.5; inspect undersides and remove supports without damaging teeth. |
| Sun cartridge | Flange adds **387 mm²** at print Z4.5. |
| Cradle/U-frame | Inspect underside recesses, horizontal bearing/clamp holes and finished bearing surfaces. Slicing success does not validate support removal or circular bore accuracy. |
| Gears | Approximate tooth-tip chord is **0.704 mm**. Inspect extrusion coverage with the final profile and verify printed tooth mesh/strength physically. |

The 8 mm model spacing is not an 8 mm support/brim spacing guarantee. The dry run
included automatically generated supports/brims and checked their extruded path
bounds, but a final Bambu Studio slice must still be inspected after corrections.

## Loads and physical gates

At 4°/s and assumed 4096 half-steps per motor turn, pan requires **182.04
half-steps/s**, tilt **91.02**, each below the configured 800 limit. Ideal full
travel takes 80 s pan/30 s tilt before acceleration. This is arithmetic, not a
tested firmware or motor capability.

The STL cradle contains 18.467 cm³ of solid volume. At an explicitly assumed
1.25 g/cm³, its full-solid mass is **23.08 g** and maximum gravity moment about
tilt is **4.475 mN·m**. Actual infill changes that mass/distribution.
Adding an assumed 150 g camera gives:

| Camera radial CG offset | Conservative camera + cradle gravity moment | Motor requirement: 2× margin, 2:1 drive, assumed 50–75% efficiency |
|---|---:|---:|
| 2 mm | 7.42 mN·m | 9.89–14.83 mN·m |
| 5 mm | 11.83 mN·m | 15.77–23.66 mN·m |
| 10 mm | 19.19 mN·m | 25.58–38.37 mN·m |
| 20 mm | 33.90 mN·m | 45.19–67.79 mN·m |

These scenarios omit cable drag, friction, acceleration and purchased moving
hardware. There is no verified running-torque curve for the owned motors, so
neither axis has a demonstrated torque margin. Pan cable/bearing drag needs
measurement. FEA, fatigue, tipping and layer-strength qualification lack measured
loads, material properties, print structure and support conditions.

Before physical release, measure the intact camera/clip/socket/CG; both motors;
bearings and race lands; belt/pulleys; screw/nut/insert/tool envelopes; populated
PCBs; USB breakout and connector/cable geometry. Confirm filament/nozzle.
Then validate fits, support removal, fastener tightening, cable range, backlash,
repeatability, coil temperatures and power integrity on progressively loaded
prototypes. Homing hardware is absent; software travel limits are not yet a
physical cable-protection system.

## Reproduce and inspect the evidence

Run from repository root; audit tools write only under `exports/reports/preprint`.
The original manufacturing archive remains the unchanged P2 baseline and does
not contain this subsequent audit. Do not regenerate it as a release until the
findings are resolved.

```sh
uv pip sync --python .venv/bin/python requirements-audit.txt
.venv/bin/python -m pip check
.venv/bin/python -m pytest -q
.venv/bin/python -m tools.validate_artifacts
.venv/bin/python -m tools.verify_preprint_package
.venv/bin/python -m tools.verify_print_layers
.venv/bin/python -m tools.verify_dense_motion
.venv/bin/python -m tools.verify_mechanical_interfaces
.venv/bin/python -m tools.verify_parameters_and_loads
node viewer/scripts/verify-model.mjs exports
npm --prefix viewer run build
```

The two mechanical/parameter diagnostic commands intentionally exit **1** for
the current findings. Their P2-specific probes must be rebased after geometry
changes; a report with a different CAD hash does not validate new geometry.
The layer and dense-motion checks remain finite/simplified evidence.

For a separately installed PrusaSlicer 2.9.4:

```sh
.venv/bin/python -m tools.verify_slicing --slicer /absolute/path/to/prusa-slicer
```

This audit used official Ubuntu package binaries extracted into
`/tmp/camx-preprint-slicer/root`, without a system install. That local invocation
also required
`LD_LIBRARY_PATH=/tmp/camx-preprint-slicer/root/usr/lib/x86_64-linux-gnu`.
Configuration: [preprint-slicer.ini](../tools/preprint-slicer.ini).
The slicer is optional and not included in the Python dependency lock.

Detailed evidence:
[package](../exports/reports/preprint/package-integrity.json),
[layers](../exports/reports/preprint/print-layers.json),
[motion](../exports/reports/preprint/dense-motion.json),
[mechanical interfaces](../exports/reports/preprint/mechanical-interfaces.json),
[parameters/loads](../exports/reports/preprint/parameters-and-loads.json),
[slicing](../exports/reports/preprint/slicing.json).
Per-plate slicer logs are alongside those reports.

## Release order

1. Preserve the selected U-body appearance while correcting load paths, gear/
   shaft retention, clamps, fasteners and usable belt adjustment.
2. Resolve measured cable/electronics mounting and fit-parameter propagation.
3. Model selected hardware, assembly/tool paths and dimensional tolerances;
   rerun the local checks on a new source hash.
4. Inspect final machine/material slices, then print coupons and an empty
   mechanism for physical fit/load testing before a full cosmetic set.
