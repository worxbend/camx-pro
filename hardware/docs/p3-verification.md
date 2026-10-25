# P3 local verification

CAD corrections for the sixteen P2 findings are implemented, and all required
local geometry, motion, export and slicing checks pass. Physical qualification
remains open. These results support fit prototyping, not a guaranteed functional
or production-qualified assembly.

CAD SHA-256 (re-verified 2026-10-25 after the base column reinforcement):
`d3cd172448dd1d1a7f3b6e78b125dc25e16eb60e9dd4eb934b0805bdf9a10e2a`

## Results

| Check | Evidence |
|---|---|
| Regression suite | 29 passed, including the printed-substitute tests; 14 upstream Lib3MF deprecation warnings |
| Sixteen P2 interfaces | All 16 nominal CAD probes passed |
| Printable geometry | 47 valid, connected parts; watertight, consistently wound STL meshes |
| STEP round-trips | Passed; see bonnet boundary comparison below |
| Plate geometry | 17 layouts fit the A1 mini with the configured margins |
| Neutral assembly | No rigid intersections above 0.05 mm³ |
| Whole-assembly motion | 69 poses, 147,217 computed pair checks and 215,240 rigid-invariance reuses; no overlaps above 0.05 mm³ |
| Dense tilt | 71,753 pair checks at 1° increments, including ±1 mm motor adjustment; zero overlap |
| Planetary profiles | 11,528 checks at 0.25° carrier increments; zero overlap; minimum sampled profile gap 0.139 mm |
| Independent tilt review | 363 combined poses / 2,178 pairs; zero overlap. Recorded for CAD `e4c21f8d…`; not re-run, as the later change is confined to the stationary base shell |
| Pan cable paths | 65 pan samples, 0.6 mm centerline spacing, actual guide meshes; passed |
| Parameter propagation | Bearing-clearance and bonnet-wall changes alter the generated solids |
| Print-layer screening | 3,616 layers across 47 parts; no section errors |
| Slicing | All 17 plates passed with PrusaSlicer 2.9.4; minimum extruded-path center margin to bed edge 2.822 mm |
| Release package | 285 checksums, 47 individual 3MF files, 17 plates and 18 archived CAD files passed |
| Viewer model | 103 GLB components, coordinate conversion, offset tilt drive and planetary joint checks passed |
| Viewer build | Vite build passed; nonblocking Three.js bundle-size warning |

Machine-readable evidence is in `exports/reports/` and
`exports/reports/preprint/`. Each report identifies the CAD revision. Plate
reports also identify the exact 3MF bytes; packaging checks those hashes.

## Base column reinforcement

The four 6 mm cable-guide columns in the base shell gained a conical root
flare (Ø14 mm at the floor, blending into the column 20 mm up) and up to eight
2.4 mm gussets reaching 13 mm out and 30 mm up. The reinforcement is trimmed to
keep 0.6 mm clear of the electronics trays and 0.2 mm radial clearance around
the lid's corner bosses, so columns next to trays carry fewer gussets. The
nearest gusset is about 63 mm from the pan axis; moving parts below Z36 stay
within 35 mm. The base shell remains one valid solid with no new layer islands.
Every check in the table above except the independent tilt review was re-run
for this revision. The strength gain is geometric only; no load or print test
has been performed.

## Corrections found during final verification

- The larger provisional C200 envelope exposed a cradle/rear-cover collision.
  The rear shelf is shorter, strap slots are relocated, and the cover clears
  the swept cradle. The independent review found minimum sampled gaps of
  1.155 mm to the cover, 1.434 mm to the motor and 1.800 mm for the USB plug
  to the cover. These concern rigid nominal envelopes.
- The moving cable clamp needed rounded corners to clear its conduit.
  Cable checks now test centerlines throughout solids, including deep
  penetration, rather than only points close to a surface.
- Generated supports collided between adjacent small parts despite their
  nonintersecting CAD boxes. The USB power tray now has its own plate; the
  small-part plate uses 20 mm spacing. Both corrections passed slicing.
- The bonnet's adaptive volume calculation differs by 0.002171% after STEP
  round-trip. Its bounds agree within 0.00001 mm, and exact B-rep subtraction
  in both directions leaves no solids. The checker records this boundary
  comparison rather than relaxing the volume threshold. STL tessellation is
  separate; the largest measured mesh-volume difference is about 2.013%,
  within the configured 3% screen at 0.08 mm export deflection.

## Printing and mechanical limits

The assembly contains 104 named components, including simplified purchased
hardware and one fit coupon. Its overall bounds are approximately
162.08×163.04×182 mm; it is assembled from individually printable parts.
The largest part footprint is approximately 162.08×162.08 mm.

PLA is owner-selected; a 0.4 mm nozzle is assumed from the “4mm” reply.
Thirty-two parts have geometric overhang flags. The USB power tray and fixed
cable guide tray also contain layers that need support beneath new regions.
Use the actual Bambu Studio material profile and inspect support removal.
Audit G-code used a generic geometry profile and was deleted.

The ideal pan paths have approximately 0.200 mm minimum guide/clamp clearance
and 2.500 mm separation between the two cable surfaces. Their sampled length
variation is below 0.002 mm. This verifies the prescribed paths, not the
behavior of a real cable. Fixed tails and the camera's tilt service loop
are not fully modeled or collision-qualified.

The load report uses Anker's approximate 83 g mass and explicitly assumed
center-of-gravity offsets, material density and transmission efficiency.
It does not establish available running torque, tooth strength, stability,
thermal performance or service life.

## Physical release gates

1. Measure the actual camera/clip/plug, motors, populated boards, bearings,
   shafts and selected fasteners; update parameters and regenerate if needed.
2. Print fit coupons and trial the planet cap and cradle clamp in the selected PLA.
3. Assemble the empty actuator; measure endplay, backlash, drag and belt tension.
4. Install actual cables and manually traverse the mechanism with a supported
   dummy load, including the unmodeled fixed tails and tilt loop.
5. Measure loaded motor performance and PLA temperatures; commission a reliable
   reference and limits before powered full travel.

Finite sampling is not general continuous-motion proof. No physical printing,
electrical test or powered motion has been performed. See the
[closure register](p3-design-closure.md) and [assembly guide](assembly.md).
