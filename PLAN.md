# CAMX Pro — Parametric PTZ Design and Implementation Plan

Prepared: 2026-10-20. Reference project: `../camx`, inspected at commit
`800f05acccf26577ddd18de381491bd0af53b88a`, including its current local files.

This document is the implementation prompt for a new project in `camx-pro`.
Implementation has progressed to the P3 parametric CAD revision, including
corrections for the sixteen P2 audit findings, manufacturing exports and an
inspection viewer. See `README.md`, `docs/status.md` and
`docs/p3-design-closure.md` for the current milestone.
Firmware and physical qualification remain pending.
All proposed dimensions and performance targets retain their verification status.

## 1. Implementation brief

Build a complete, reproducible **3D-printable pan–tilt camera assembly** around
the owner's intact Anker PowerConf 2K webcam, two existing **5 V 28BYJ-48**
steppers, two ULN2003 modules, ESP32-WROOM-32 DevKit, USB-C power breakout,
available capacitors, and integration PCB.

**The primary deliverable is a compact mechanical product with professional
industrial design, implemented parametrically in Python + build123d.** Firmware,
the browser remote, and the CAD viewer support that product.

Priorities, in order:

1. Reliable load support, movement, cable management, and camera retention.
2. Practical FDM printing, assembly, maintenance, and component reuse.
3. Compact measured packaging and a low center of gravity.
4. Matte-black commercial appearance: rounded base, flowing U-yoke, concealed
   mechanisms, controlled seams, and minimal visible fasteners.

Keep the webcam housing, optics, electronics, factory clip, and USB connection
intact. Use its existing mounting interface if verified; otherwise use a padded,
removable cradle. Do not drill the camera or substitute servos or different motors.
Additional bearings, fasteners, homing switches, and a small transmission are
permitted when justified and listed in the BOM.

Target pan is approximately **−160° to +160°** and tilt **−30° to +90°**.
These are design targets, not established safe limits. No continuous rotation,
optical zoom, 4K upgrade, or camera video transport through the ESP32 is implied.
The webcam remains connected directly to the host computer.

## 2. What to retain from `../camx`

The existing project is a substantial servo-based prototype, not an empty
starting point. Use its source patterns selectively.

| Existing feature and evidence | Treatment in CAMX Pro |
| --- | --- |
| `cad/model.py`, `cad/parameters.json`: build123d assembly, 13 main printable parts, fit coupon, separate hardware envelopes, print transforms, export manifest | Retain the parametric/export approach; redesign all servo interfaces and packaging around the actual steppers and two drivers. |
| Original geometry: 100 × 82 × 38 mm base, Ø92 mm platform, 50 × 51 × 41 mm camera envelope, assumed 150 g camera | Historical comparison only. These are not verified dimensions for this build or a mandatory new enclosure size. |
| 6805 pan bearing, opposite 625 tilt bearing, removable covers and camera mounting | Reuse load-path concepts; choose bearings from the new load, cable-bore, and packaging requirements. Existing ownership is unconfirmed. |
| `firmware/src/main.cpp`, `include/motion.h`: PlatformIO/Arduino, two 50 Hz servo PWM channels, NVS calibration, HTTP and serial control | Preserve application behavior, replace PWM and pulse calibration with four-phase stepper control per motor. |
| `include/motion_planner.h`, `lib/ruckig/`: vendored Ruckig 0.15.3, synchronized absolute trajectories, bounded acceleration/jerk, independent jogging | Evaluate reuse above a new deterministic phase scheduler. The current 20 ms servo update loop is not a stepper scheduler. Preserve upstream license/provenance. |
| `jog_lease.h`, `connection_pause.h`: 100 ms client refresh, 500 ms jog lease, five-second command watchdog, stale-packet fencing | Preserve intent and regression cases; qualify stopping and reference validity for open-loop steppers. |
| Firmware 0.5.2: disconnect/timeout holds preserve armed state; explicit STOP remains latched; boot is disarmed | Use source behavior rather than older conflicting README passages. Reconnection never resumes an interrupted command automatically. |
| `client/`: SolidJS remote, held directions/diagonals, keyboard control, precision moves, presets, JSON backups, calibration, guides, activity log, demo | Adapt the existing UX. Replace servo microsecond fields and hardcoded angle bounds with stepper calibration and homing state. Presets are currently browser-local. |
| `tools/serve_control.mjs`, `tools/stage_control.mjs`: localhost LAN bridge and ESP32 LittleFS client staging | Preserve offline/local operation and credential handling. |
| `viewer/`: Vite/Three.js, real CAD GLB, orbit, pan/tilt preview, explosion, visibility, wireframe, downloads | Adapt to new parts and ranges; generate joint membership and pivots from CAD metadata instead of hardcoded servo part lists. |
| `tests/`, `client/tests/`, viewer QA scripts, release tools and Actions | Retain useful test/package structure and add stepper, homing, combined-motion, cable, and manufacturing checks. |

Important migration findings:

- Existing `/home` calls `move(0,0)`; it is **not physical homing**. Initial ARM
  also assumes zero. Neither behavior establishes a stepper's position.
- `axisConfigSafe()` limits motion to ±60° pan / ±25° tilt. Firmware, client,
  demo, storage validators, viewer, and CAD must all adopt the new envelope.
- Existing precision nudges compute absolute targets on the client. There is
  no separate relative-position HTTP endpoint or WebSocket implementation.
- `exports/validation.json` records **624 checks** with explicit limitations:
  approximate hardware, sampled poses, no cable deformation or physical load
  tests. This is an existing report, not a fresh test result. Its axis sweeps
  do not validate all combined pan/tilt poses.
- The original source has local changes. Leave `../camx` untouched. Copy only
  reviewed source; exclude credentials, configured binaries, caches, old exports,
  and release archives. Generate new artifacts in this repository.
- The old audit reports limited firmware flash headroom and a Python dependency
  conflict. Recheck dependencies and resource budgets during implementation;
  do not inherit old audit conclusions or security-alert counts as current facts.

## 3. Photo evidence and hardware identification

Use these references in this order: actual hardware, measured interfaces, desired
appearance, then historical CAMX assumptions.

| Reference | Observation and design consequence |
| --- | --- |
| [Hardware overview](references/hardware-overview.png), supplied Image #1 | Two geared steppers, an ESP32-form-factor board, driver-board hardware, and a small connector breakout. One green board is shown from its reverse; its identity and wiring cannot be confirmed from that face. |
| [Motor close-up 1](photo_6_2026-10-20_11-12-44.jpg) | Label visibly identifies a 28BYJ-48, 5 V DC motor. |
| [Motor close-up 2](photo_7_2026-10-20_11-12-44.jpg) | A second 28BYJ-48, 5 V DC motor has different markings. Measure and characterize each independently. |
| [Camera side](photo_4_2026-10-20_11-12-44.jpg) | Rounded Anker housing with ventilation and original folding clip. Preserve these features and their clearances. |
| [Camera front](photo_5_2026-10-20_11-12-44.jpg) | Square rounded face, lens, openings, indicator, and markings for 2K and adjustable FOV. Do not obscure the front or privacy controls. |
| [Primary styling reference](references/ptz-design-reference.png), supplied Image #2 | Low rounded base, recessed rotating platform, continuous U-shaped support, concealed pivots, restrained seams. Apply these proportions around the real Anker body. |
| [Additional PTZ reference](photo_3_2026-10-20_11-12-44.jpg) | Symmetric enclosed yoke and integrated base. Its advertising claims, display, and tally light are not project requirements. |

The two supplied PNGs are preserved locally so this prompt does not depend on
temporary attachment paths. Historical `../camx/photo_9_...jpg` and
`photo_10_...jpg` also show the camera mounted on a support, but do not establish
thread dimensions or engagement depth.

The camera resembles the PowerConf C200 family; this is a visual inference,
not confirmed model identification. Check the underside label against
[Anker's C200 product reference](https://www.anker.com/de/products/a3369).
The ESP32 programming connector appears different from the old project's
USB-C assumption; verify its type. The custom integration PCB and capacitor
values are owner-reported and not independently established by these images.

### Measurements required before final mounting geometry

Record value, unit, uncertainty, source, date, and status for every parameter:
`measured`, `datasheet`, `provisional`, or `derived`. Photographs without a
reference scale must not be treated as dimensional measurements.

| Component | Required measurements |
| --- | --- |
| Camera | Exact model; body and folded-clip envelope; mass with intended cable; CG relative to mounting surface; thread type, location, usable depth; connector and plug envelope; cable diameter and comfortable bend radius; privacy-control and ventilation keep-outs. |
| Each motor | Body diameter/depth; mounting-ear span, hole pitch/diameter and thickness; output-shaft diameter, flats, usable length and offset from body center; lead exit, connector size and cable length; mass; coil resistance and phase order. |
| Each driver | PCB outline/thickness, mounting holes, underside solder height, component height, connector insertion space, pin labels, power jumper and clamp-diode routing. |
| ESP32 | Board revision, outline, holes/headers, underside clearance, antenna location, USB plug access, BOOT/EN access, exposed GPIOs and power circuit. |
| Power/electronics | USB-C board and receptacle, actual pinout and CC components; capacitor values/rating/size/polarity; integration PCB dimensions, pads, connectors, and mounting. |
| Manufacturing | Printer build volume, nozzle, material, usable bridge/overhang capability, measured fit-coupon results, available bearings and fasteners. |

A provisional concept may proceed before these measurements. Final mounting
holes, fits, shaft adapters, print release, and load claims may not.

## 4. Preferred motor placement and alternatives

### Recommended starting architecture

Use **a coaxial vertical PAN motor driving a planetary actuator in the base** and
**a horizontal TILT motor low behind the camera with a concealed 2:1 belt**.
Support the rotating platform and both sides of the camera cradle independently
of the motor shafts.

This is the preferred engineering layout from the current evidence, not a
dimensionally proven optimum. Its advantages are a coaxial supported output,
low stationary motor mass, a narrower symmetric yoke, and serviceable concealed motors.
The planetary stage occupies the center; cables use the protected outer annulus.

Define assembly coordinates in millimeters: Z upward, X across the yoke,
front toward −Y, rear toward +Y. The pan axis is Z through the base datum;
the tilt axis runs along X near the **combined camera-and-cradle CG**.
Make the UI's positive tilt mean upward; in this coordinate convention that
requires the appropriate sign conversion about X. Use one tested transform
definition for CAD, drawings, viewer, and firmware.

### PAN motor: coaxial planetary actuator

- Use the existing 28BYJ-48 as the sun input. P2 has 20T sun / four 20T planets /
  fixed 60T ring, module 1.25, giving 4:1 carrier output. Verify all three planetary
  assembly constraints and phasing; see `docs/planetary-actuator.md`.
- Support each planet on a steel sleeve and bearing, with two carrier plates.
  Two 6809 bearings support the output; the motor shaft carries no structural
  camera load. Keep the sun journal separately supported.
- Print the input gear flat, make the bearing cage removable, and expose the
  carrier screws before fitting the platform. Verify bearing abutments and
  endplay from actual hardware. Gearbox strength and equal planet loading are
  not established by a collision-free model.
- Route the USB and tilt leads through the passive arm into a protected annular
  service loop outside the gearbox. Do not route loose wires between the gears.
  Measure the actual cable sweep before enabling the full target range.
- The design uses a taller base to retain the U-shaped upper body and both motors.
  It is an open-loop prototype; feedback sensors and load ratings require later work.

### TILT motor: low rear position, parallel to the camera pivot

- Retain P1's replacement of the coaxial shoulder pod with a horizontal motor behind
  and below the camera, shaft toward +X. A matched 20T/40T, 2 mm pitch belt drive
  transmits torque to a bearing-supported trunnion. Camera weight stays on the
  independent bearings. See `docs/motor-placement.md` for datums and tradeoffs.
- Roll the eccentric motor body away from the camera sweep. The nominal 160 mm
  belt sets 49.59 mm shaft spacing. Provide tension adjustment and avoid high
  preload on the small gearbox shaft.
- Keep the original webcam intact on the removable, balanced cradle. Preserve
  microphone, lens, vents, factory mounting interface and USB access.
- Use a continuous U-frame, matching recessed side covers and a rear motor
  bridge. Print each manufactured part as a separate connected solid.
- Purchased pulley/belt dimensions remain procurement envelopes. Verify hub
  engagement, set-screw access and supplier tooth compatibility before fit release.
- Check cable motion and torque physically; an attractive exterior or finite
  rigid-body pose sweep cannot establish those properties.

### Placement comparison and measured follow-up

| Option | Packaging and functional tradeoff | Decision |
| --- | --- | --- |
| Rear-offset vertical pan + coaxial shoulder tilt | Clear center route, short tilt drive; adds pan gearing and lateral motor housing | P0 baseline; replaced because of side-pod width. |
| Coaxial vertical pan + coaxial shoulder tilt | Fewest transmission parts and least added pan backlash; competes with central cable passage and may increase vertical stack | Comparison baseline only; P2 retains the requested planetary module. |
| Coaxial planetary pan + rear belt-driven tilt | Independent carrier bearings and symmetric upper body; adds carrier hardware and base height | Selected for P2 at the owner’s request. |
| Both motors inside stationary base | Lower moving mass; tilt transmission must cross the rotating pan joint, introducing coupled shafts/gears and more complexity | Reject for the first prototype. |
| Single-arm support | Fewer exterior parts; greater cantilever stiffness and bearing demands | Compare briefly, but favor the two-sided U-yoke for this camera and motor class. |

Compare at least the first three layouts using the same measured hardware and
motion envelope. Report base footprint/height, total neutral width/depth/height,
swept envelope, part count, printed volume, additional hardware, assembly access,
estimated speed/torque margin, cable clearance, and support requirements.

Use true component envelopes including leads, connectors, fasteners and removal
paths. Show top and side packaging sections. Minimize the selected planetary
and rear-belt configuration; do not minimize height by creating an unnecessarily wide base,
or make a single-arm mechanism appear compact by excluding its load supports.

## 5. Compact industrial design for FDM

Derive the outer shape from the mechanism and electronics packaging. Do not
start with a visually small shell and force the components into it.

- Low rounded-square or cylindrical base with a broad stable stance, subtle
  upper taper, and an inset pan platform. Keep heavy stationary items low.
- Continuous-looking U-yoke made from separately printable structural arms and
  removable covers. Use generous arm-root transitions and local ribs.
- Preserve the recognizable Anker camera face and housing. Shape the cradle
  closely around verified keep-outs; avoid a bulky second camera enclosure.
- Matte black or graphite throughout. Achieve finish through printable geometry,
  appropriate filament and optional finishing; do not require injection molding.
- Put service seams on the base underside, yoke rear, or shoulder cap. Use
  locating lips and consistent gaps. Conceal screws while keeping a straight
  screwdriver path and a practical disassembly sequence.
- Recess the USB-C power input without preventing full plug insertion. Keep
  the ESP32 programming connector and buttons accessible after bonnet removal;
  add a dedicated hatch when measured connector access permits it.
- Avoid unsupported domes, trapped support, inaccessible fasteners, cosmetic
  features that block microphones/vents, and excessive decorative shell thickness.

Treat shell wall thickness, arm thickness, ribs, corner radii, seam gaps,
clearances and fastener bosses as parameters. Initial **design allowances**
may use roughly 2.4–3.0 mm enclosure walls, stronger local bearing/arm sections,
and 0.2–0.4 mm per-side sliding clearances. These are coupon-test starting
assumptions, not measured hardware dimensions or universal printer tolerances.
Specify per-side versus diametral clearance explicitly.

Use metal fasteners/axles or suitably rated bushings for primary load paths.
Do not inherit the original experimental printed axle/nut as the default.
Design removable bearing retainers and calibrated insert or captive-nut pockets;
avoid irreversible bearing press fits in the first prototype.

### Planned printable components

| Part family | Function and print strategy |
| --- | --- |
| Base structural tray + lower service cover | Electronics and motor mounting, feet, optional ballast/tripod interface; broad flat print faces. |
| Pan bearing carrier/retainer + supported hub | Defined load path and axial retention; fit coupons before full parts. |
| Pan gear/pinion or selected pulley set | Replaceable wear parts; print gear/pulley faces in a suitable orientation and inspect tooth quality. |
| Rotating platform/yoke bridge | Carries both arms with keyed alignment and accessible bolts; separates motion structure from cosmetic skins. |
| Drive arm + passive arm | Coaxial bearing seats, ribs and harness channels; orient principal loads along strong layer directions. |
| Camera cradle + trunnions | Removable camera attachment, balance adjustment, cable anchoring, clearance for original clip and USB plug. |
| Shoulder covers and pan skirt | Conceal hardware with controlled seams; split curved shells to avoid trapped supports. |
| Motor carriers, PCB tray, cable retainers, sensor brackets | Independently replaceable, easy to inspect and assemble. |
| Fit coupons | Shaft-flat couplings, bearing seats, fasteners/inserts, camera interface, shell joints and connector apertures. |

Do not fix the final part count prematurely. Every printable component needs
its own valid solid, stable ID, material, orientation, and support instructions.
Use the owner's selected PLA for initial fit trials; qualify its stiffness,
creep and temperature behavior before sustained motor operation. The printer is
the Bambu Lab A1 mini, with a 180×180×180 mm build volume. The nozzle is assumed
to be 0.4 mm pending confirmation. Use the actual printer/material profile and
inspect supports before printing.

## 6. Cable routing and internal electronics

Keep the ESP32, both drivers, power distribution and capacitors stationary in the
base. Position the ESP32 antenna near a nonmetallic outside wall, away from motors,
large conductors and dense wiring. Compare flat and edge-mounted driver trays;
include connector insertion/removal and underside solder clearances.

The rotating harness contains the tilt motor's five conductors and any moving
sensor wiring. Camera USB remains electrically separate, with its original
continuous cable and host connection. No USB-data splice or general-purpose
slip ring is included.

Plan two distinct flex regions:

1. **Pan region:** a protected annular service loop outside the planetary stage,
   with fixed and moving strain-relief anchors. Model and test neutral, both pan
   extremes, and repeated reversals; do not feed cables through the sun or gears.
2. **Tilt region:** a short relaxed USB loop from the yoke to the camera. Anchor
   the cable jacket, preserve plug access, and prevent the cable from applying
   significant tilt torque or catching at +90°.

Route the tilt motor lead inside its arm; it flexes across pan, not with camera
tilt. Size channels for actual plugs or use split channels and removable covers.
Provide smooth exits and grommets. Keep all harnesses outside gear teeth, bearing
races, hard stops, screws and pinch points. If fully hidden routing cannot meet
the real bend radius, use a small protected rear loop and document the tradeoff.

Use a regulated **5 V / 2–3 A** supply as the owner's power target, subject to
measured demand and connector capability. Feed drivers directly from a suitable
distribution point; feed the ESP32 separately from that point with common
ground. Verify capacitor polarity, rating, placement, inrush and driver heating.

ULN2003 is a phase-switching Darlington array, not a STEP/DIR driver with
regulated microstepping. Verify each board's input mapping and jumper wiring,
3.3 V input behavior at the actual coil current, voltage drop and package
dissipation. Ensure flyback COM connects correctly to the motor supply.
[TI's ULN2003A datasheet](https://www.ti.com/lit/ds/symlink/uln2003a.pdf)
provides the device-level electrical reference; it does not identify the
photographed module's routing.

Verify separate CC1/CC2 sink termination on the USB-C breakout and the source's
advertised current. A connector or passive breakout does not guarantee 3 A.
If additional current requires source detection that the existing board lacks,
include a suitable sink/current-detection solution; do not assume arbitrary
USB ports are adequate. Keep operation at 5 V.
[TI's USB-C guide](https://www.ti.com/lit/SLYY228) and the
[USB Type-C specification hosted by TI](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/196/USB-Type_2D00_C-Spec-R2.4-_2D00_-October-2024.pdf)
explain termination and current advertisement.

Inspect the exact DevKit power circuit before combining external supply and
programming USB. Define a source-isolation procedure or circuit.
[Espressif's DevKitC guidance](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html)
documents mutually exclusive supply options for that reference board; do not
assume an unidentified clone has equivalent protection.

## 7. Homing, limits and mechanical stops

Prefer **one physical home sensor per axis** as the smallest useful addition.
Use compact normally-closed microswitches or appropriate Hall sensors and
magnets after packaging evaluation. They are additions, not photographed inventory.

- Pan: stationary sensor in the base, rotating cam/flag on the platform.
- Tilt: sensor on the yoke, cam/flag on the cradle. Its wiring crosses pan only.
- Locate each reference near a travel end, before a protective hard stop, with
  room for switch overtravel, braking, adjustment and replacement.
- Home slowly: handle an already-active sensor, search a bounded distance,
  stop, back off until released, reapproach slowly, then set the calibrated offset.
- A missing/stuck sensor, inconsistent state, timeout or excess search travel
  causes a fault. Never establish home by deliberately stalling into a hard stop.
- Sequence homing axes based on verified cable and collision clearances.
  Specify a safe manual starting arrangement for an initially unknown pose.
- Mechanical stops belong to the supported structure, beyond software limits.
  They are protective backups, not routine travel endpoints.

If the owner uses no extra sensors, provide a **manual alignment and Set
Reference** mode with a physical alignment mark or fixture. After power loss,
disarm or uncertain motion, require alignment again. Persisted step counts do
not prove actual position. Clearly distinguish `Home / reference search` from
`Go to center` in the interface.

## 8. Engineering calculations and feasibility gates

### Torque, speed and stability

Use measured camera, cradle, fastener and moving-harness mass and CG. For tilt:

```text
required_axis_torque =
    gravity_torque + inertia_about_tilt_axis × angular_acceleration
    + bearing_friction + cable_torque

gravity_torque_bound = combined_moving_mass × g × CG_offset_from_axis
available_axis_torque = measured_motor_output_torque_at_speed × ratio × efficiency
axis_speed = measured_motor_output_speed / ratio
```

Evaluate actual gravity torque over the tilt range, not just the bound. As a
**sensitivity example only**, 0.150 kg at a 10 mm offset contributes about
0.0147 N·m before acceleration and friction; at 2 mm it contributes about
0.00294 N·m. This illustrates why balancing is preferable to adding large
reduction. It is not a measurement of this camera.

For pan, include the complete yoke/camera assembly's rotational inertia, bearing
friction, harness twist and acceleration. Include off-center mass in bearing
moment and base tipping calculations. Model motor/transmission inertia where
material, gear tooth forces, trunnion bending, bearing spacing and retention.

The photos establish model labels, not torque curves, exact gear ratio,
backlash or maximum reliable stepping rate. Public
[Waveshare 28BYJ48 specifications](https://www.waveshare.com/product/robotics/motors-servos/motors/5v-step-motor.htm)
describe a related product, not a guaranteed match to these units. Measure
steps per output revolution, backlash and usable loaded torque/speed separately
for both motors; do not hardcode nominal “4096” as exact calibration.

Set a documented torque margin against **measured running torque**, provisionally
targeting at least 2× the calculated demand at the selected operating speed.
Report any failure to achieve it. Holding/stall torque is not a continuous
motion rating. Derive acceleration, speed and full-travel time from this budget.

Use the better characterized motor for the more demanding axis, typically tilt
if gravity dominates. If performance is insufficient, first rebalance, reduce
cradle mass and cable drag, then reduce acceleration/speed or use modest
reduction/counterbalance. Retain the specified motors.

### Required validation

- Collision and clearance checks across the **combined pan/tilt envelope**,
  including limits, intermediate poses, camera clip, actual plug bodies,
  covers, trunnions, fasteners, sensors and harness corridors.
- Adaptive sampling or swept-volume checks with a declared minimum clearance
  and tolerance budget. A coarse grid is evidence only for sampled poses.
- Physical cable checks through all extremes and repeated reversals; a static
  centerline drawing cannot validate flexible-cable behavior.
- Base tipping/sliding margin with measured CG, foot placement and cable pulls;
  add discreet ballast or mounting provisions only when needed.
- Driver/motor temperature, supply sag, ESP32 resets and Wi-Fi reliability with
  both axes moving and holding under load in the closed enclosure.
- Printable geometry, insert/bearing fits, layer direction, screw engagement,
  service access, tool access and a credible assembly order.
- Repeatable homing and preset-return trials measured externally. Record
  backlash and error; step resolution is not positioning accuracy.

Physical commissioning proceeds from coupons → empty structure → supported
dummy load → real camera. Record unperformed checks as pending, never passed.

## 9. Parametric CAD implementation

Keep hardware definitions, structure, cosmetic shells, kinematics and export
logic separate. Proposed layout:

```text
camx-pro/
  PLAN.md
  references/                  # preserved supplied references
  cad/
    parameters.json            # dimensions, fits, materials, limits, ratios
    parameter_sources.json     # provenance, uncertainty, verification state
    hardware.py                # measured non-print component envelopes
    joints.py                  # reusable bearings, couplings and fasteners
    transmissions.py           # manufacturable gear/pulley geometry
    parts/                     # base, pan, yoke, cradle, covers, carriers
    assembly.py                # joint tree, datums, component placement
    drawings.py                # dimensions, sections, BOM callouts
    export.py
  firmware/                    # stepper firmware and native-testable core
  apps/
    site/                      # project page, CAD viewer, manufacturing previews
    remote/                    # Solid.js 2 browser remote
    tui/                       # Scala/Glyphora terminal remote
  packages/                    # shared browser protocol and localhost bridge
  contracts/                   # language-independent API fixtures
  tests/                       # CAD, kinematics, firmware, transport
  tools/                       # render, validate, stage, package
  docs/                        # measurements, decisions, wiring, build guide
  exports/                     # generated parts, assembly, drawings, renders
```

Requirements:

- Stable part IDs and metadata separating printed parts, purchased hardware,
  cosmetic references, cable envelopes and fit coupons.
- One source of truth for axis datums, direction signs, component hierarchy,
  target limits, validated limits and transmission ratios. Generate firmware
  limits and viewer metadata from the validated configuration.
- Explicit assembly transforms and separate print transforms. Maintain
  millimeters in CAD/STEP/3MF and document GLB unit/up-axis conversion.
- Guard against impossible parameter combinations before export. Demonstrate
  rebuilding with changed camera envelope, motor variant and fit allowances.
- Retain genuine analytic CAD solids in STEP. Export individual STL/3MF with
  controlled meshing tolerances, outward normals, no disconnected fragments,
  and sensible placement at Z=0.
- Use build123d's
  [documented import/export tools](https://build123d.readthedocs.io/en/latest/import_export.html)
  for suitable geometry formats. Build dimension annotations and PDF generation
  explicitly; unannotated SVG projections are not dimensioned drawings.
- Check slicer import, part separation, scale, orientation, supports and plate
  size. A “print assembly” must exclude electronic hardware and fit-envelope
  solids. Supply separate reference-assembly and print-layout 3MF files.

## 10. Firmware and control migration

Implement after the mechanical interfaces are defined; bench characterization
may begin earlier. Preserve the existing local-control experience.

### Stepper motion core

Replace LEDC servo output with configurable four-phase sequencing for each
ULN2003. Use verified half-step sequencing as the initial mode; do not promise
current-regulated microstepping from this driver.

Separate trajectory planning, integer step scheduling and phase output. Preserve
fractional step accumulation and count only emitted steps. Generate timed phase
transitions without blocking network/serial handling, without running expensive
trajectory calculations inside an interrupt, and without an unsafe catch-up burst
after a delayed task. Define and test scheduler overrun handling.

Calibrate per-axis emitted steps per motor-output revolution, external ratio,
direction, zero offset, speed, acceleration, jerk, and safe travel. Do not infer
position from wall-clock trajectory progress if required steps were not emitted.
Ruckig reuse is conditional on flash, RAM, timing and step-quantization tests.

### State and failure behavior

- Boot disarmed with `position_valid=false`.
- ARM enables a known phase safely but does not declare the current pose zero.
  Homing is a controlled mode permitted to move before reference is valid.
- Ordinary absolute/relative moves and preset recall require valid reference.
- Normal release and transport loss use a bounded stop appropriate to the
  stepper's dynamics; fence delayed packets and retain holding torque when safe.
  Keep the existing connection-hold UX only if position remains trustworthy.
- Explicit STOP cancels future motion and remains latched. An abrupt emergency
  stop may lose steps: invalidate reference when physical follow-through is
  uncertain. A GPIO STOP is not an independent power-cut safety circuit.
- DISARM de-energizes coils and invalidates reference. Support/balance the
  camera for torque loss; do not rely on an undocumented self-locking gearbox.
- Brownout/reboot, failed homing, scheduler fault and suspected stall require
  reference recovery. ULN2003 provides no stall or encoder feedback.

Choose eight output GPIOs and reserve home/STOP inputs after checking the exact
board. Avoid flash pins and inappropriate boot-strapping pins; GPIO34–39 are
input-only and lack internal pulls on classic ESP32.
[Espressif's ESP32 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf)
is the pin-capability reference. Publish a verified wiring table rather than
treating provisional pin numbers as assembly instructions.

### API and browser client

Retain HTTP first: `/status`, `/arm`, `/disarm`, `/move`, `/jog`, `/stop`,
`/heartbeat` and calibration, with a versioned stepper schema. Add distinct
reference-search, go-to-center and optional manual-reference commands.

Add relative movement with explicit delta semantics, atomic axis validation,
request IDs/deduplication and no blind retry of an additive command. Absolute
commands remain idempotent. Status reports reference validity, emitted-step
position estimate, target, faults, homing progress, current limits and capabilities.
Clearly label positions as estimates, not measurements.

Keep authentication, bounded parsing, request-intent protection, in-memory token
handling, LittleFS hosting, localhost bridge and offline demo. Use separate
CAMX Pro storage/NVS namespaces and backup schema; reject incompatible servo
calibration imports rather than silently interpreting pulse widths as steps.

Adapt remote, precision, preset and calibration views to reference state,
asymmetric tilt limits and measured speeds. Disable unsafe controls while
unreferenced or homing. Preserve pointer/keyboard cancellation, stale-response
handling, mobile usability and fresh-input-only reconnect.

Optional OBS integration belongs on the host and calls the same API for presets
or moves. Webcam video remains a separate OBS input. WebSockets, tracking,
ONVIF and optical zoom are not prerequisites for the mechanical prototype.

## 11. Drawings, renders and manufacturing package

Every final view must derive from the same assembly revision and parameter set.
Use deterministic CAD-derived rendering, for example the GLB viewer or an
offline renderer. Early generated mood images may explore styling, but cannot
serve as evidence of fit or as inconsistent substitutes for the CAD.

Required exports:

| Deliverable | Content |
| --- | --- |
| `.step` | Complete named assembly and individual editable solid parts. |
| `.stl` | Each printable component in documented print orientation. |
| `.3mf` | Print-only organized plates/assembly plus a clearly labeled non-print reference assembly. |
| `.svg` | Dimensioned front, side, rear, top and bottom views; critical part details, sections, exploded assembly and wiring. |
| `.pdf` | Dimensioned engineering pack, BOM, material/print notes, assembly, calibration and inspection instructions. |
| `.png` | High-resolution front, side, rear, three-quarter, pan extremes, tilt extremes, exploded, transparent cutaway and desktop views. |
| `.glb` + manifest | Interactive viewer using the same geometry, hierarchy, poses and part identifiers. |

Dimension overall/critical interfaces, bearing and shaft fits, mounting pitches,
thread engagement, gear ratios, axis locations, cable apertures and component
clearances. Include units, scale, revision, tolerances and provisional labels.
Exploded callouts must match part IDs and BOM entries.

The BOM distinguishes owned hardware, required purchases, optional upgrades and
printed parts. Include quantities, specifications, source/measurement status,
fastener lengths, bearing sizes, materials and estimated costs where verified.
Do not assume bearings or homing sensors are already owned.

Document print orientation, layer/perimeter assumptions, support placement and
removal, insert installation, bearing assembly, camera screw-depth limits, cable
threading, wiring, programming, homing and first movement. Include a service
sequence that can remove either motor or a driver without damaging the webcam.

## 12. Phased execution and acceptance criteria

| Phase | Work | Exit evidence |
| --- | --- | --- |
| 1 — Hardware analysis | Inventory all photos; measure interfaces, mass and CG; identify driver/power wiring; characterize both motors; establish printer profile | Measurement/provenance table, missing-input list, bench results and provisional hardware envelopes. |
| 2 — Mechanical architecture | Compare motor layouts, bearing arrangements, transmissions and cable routes; calculate torque/speed; optimize electronics packing | Selected layout with rationale, top/side sections, dimensions, interference checks and quantified tradeoffs. |
| 3 — Industrial design | Shape the compact base, U-yoke and camera cradle around Phase 2; define printable splits, seams, finish and service access | Consistent CAD blockouts and concept views with unchanged component placement; printability review. |
| 4 — Parametric implementation | Build modular build123d parts, assembly, coupons, drawings and metadata; implement stepper core and adapt client/viewer | Rebuildable source, separate valid solids, provisional exports, native firmware tests and browser build. |
| 5 — Validation | Run combined-motion/fit/export tests; slice parts; print coupons and mechanism; commission with dummy load; test homing, backlash, thermal behavior and control recovery | Automated reports plus separately recorded physical results; revise failed interfaces and limits. |
| 6 — Manufacturing package | Regenerate all formats, dimensioned documentation, consistent renders, BOM, assembly guide and versioned archives | Checked downloads and checksums, reproducible clean build, explicit prototype/physical-validation status. |

Phases 1–3 are CAD-led. Firmware feasibility work can proceed alongside them,
but interface polish must not delay proving the mechanical arrangement.
Do not freeze dimensions or generate a manufacturing-ready claim from photos.
When physical measurements are unavailable, continue independent design work
with marked provisional parameters and list the exact blocked fit decisions.

### Implementation verification

- **CAD:** valid single solids per printable part, parameter variations, critical
  fits, no unintended overlap, transform consistency, combined poses, meshes,
  3MF units and print placement; visually inspect sections and slicer previews.
- **Motion:** phase order, reversal, fractional accumulation, emitted-step counts,
  both-axis timing, limit braking, fault handling, homing states, reference
  invalidation, watchdogs and stale-command rejection.
- **Control:** production browser tests for held motion, STOP, disconnect,
  reconnect, reference gating, presets, relative-command retries, backup schema,
  calibration and desktop/mobile layouts.
- **Manufacturing:** independent read-back of exported formats, all required
  views, dimension consistency, BOM/part/callout agreement and no hardware in
  print plates.
- **Physical:** balance, full travel and cables, repeatability, speed/torque,
  temperature, power isolation, stability, print strength and assembly access.

Create documented commands such as `python -m cad.export`,
`python -m pytest tests/cad`, `pio run -d firmware`, and the client/viewer npm
scripts **when those entry points are implemented**. They are proposed interfaces,
not commands already available in this repository. Pin a tested dependency set
and include clean-environment build instructions.

## 13. Definition of done

The implementation is complete when the existing webcam and specified motors
fit a compact, enclosed, printable assembly; both axes have independent load
supports; the chosen motor positions and transmission are justified; wiring and
service access are credible; and all required editable/print/drawing/render files
can be regenerated from one parameter set.

Firmware and the remote must use the same validated movement envelope and
honestly report open-loop reference validity. CAD views, industrial design,
print files, BOM and assembly instructions must describe the same device.

Separate **CAD validated**, **software tested**, and **physically demonstrated**
status. Final physical readiness requires recorded tests with the owner's actual
components. If full travel, speed, compactness or appearance cannot coexist,
document the measured limiting factor and the smallest practical modification
while retaining the intact camera and the two existing 28BYJ-48 motors.
