# P3 design corrections and qualification

P3 addresses the sixteen P2 findings in `preprint-audit.md`. That report is historical; current results are generated from the P3 source and recorded with its SHA-256. **A nominal CAD pass is not a physical qualification.** Read the current JSON results before printing; a failed or stale check keeps its interface open.

## Change register

| ID | P3 correction | Verification |
|---|---|---|
| P1 | Base/ring/cage contact faces coincide. Matched inner/outer output spacers define 0.2 mm total endplay. Sun bearing floats axially in its cartridge. | Contact distances, bearing stack and parameter/load report |
| P2 | Lower carrier has a swept motor-head relief; output retainer heads are recessed. | Selected head envelopes swept through pan |
| P3 | Each planet has an outer-race shoulder and a screwed, nut-retained cap. | Both axial stops and carrier clearance |
| P4 | Equal steel sleeves locate in 8.05 mm carrier pilots, independently of M3 screw clearance. | Pilot/shaft contract; fit coupon still required |
| P5 | Bearing clearance drives gear, cartridge and output pockets. | Actual rebuilt volumes after parameter change |
| T1 | Motor and rear-cover bolts pass through the frame into captured nuts. | Shank and driver access probes |
| T2 | True capsule slots and relieved body/hub paths permit ±1 mm adjustment; cover bosses clear the flange sweep. | Five adjustment positions |
| T3 | Recessed retainer heads have clearance to the driven hub. | Selected head envelope |
| T4 | 8 mm-wide split clamps, captive M3 nuts and taller roofs replace thin pilots. | Geometry and fastener probes; PLA clamp trial required |
| T5 | Two 28 mm trunnions, inner/outer race spacers and a passive collar define the thrust path. | Endplay extremes and rotating component clearance |
| E1 | Bonnet has a seam-open cable entry with removable split inserts. | Intact 12×8 mm plug envelope, rotated 8 mm across opening; no cable cutting |
| E2 | Four 14 mm bosses connect to the bonnet through 8 mm-wide radial webs. | Connected solid and offset-wall checks |
| E3 | Horizontal PCB trays, fastening ears, insulating straps and a capacitor cup provide retention. | Seating/contact and interference checks; populated-board details provisional |
| E4 | Service hatch has 6 mm receivers and recessed heads. | Engagement geometry |
| E5 | A true 3 mm normal-offset bonnet replaces independent lofts. | Wall rays, parameter response, actual printer bounds |
| E6 | Separate motor/USB rolling layers, sidewalls, removable ceilings, lay-in windows and fixed/moving split clamps. | Constant-length route tests and sampled tube/actual-mesh clearances |

## Design tradeoffs

The nominal base is 160×160×89.5 mm; the curved loft is slightly wider than its section dimensions. Use the manifest's measured bounds. The camera pivot is Z154.5 mm. Increased space accommodates R20 USB bends, independent motor wiring, load-carrying bearings and accessible fasteners. This is an engineering compromise, not a claim of globally minimum size.

Four 20-tooth planets, a 20-tooth sun and a fixed 60-tooth ring retain the requested 4:1 planetary actuator. Both owned 28BYJ-48 motors are retained. The intact camera sits in the removable cradle; no webcam modification is authorized.

## Physical gates that CAD cannot close

1. Measure folded C200, plug/boot, motor shafts, populated boards, bearing race lands and selected screw heads. Anker's approximate dimensions and mass are recorded in `c200-manufacturer-data.md`.
2. Print fit coupons and one planet/cap/shaft clamp in the selected PLA. Check bearing slip/retention, nut loading, clamp grip, layer splitting and shaft slip.
3. Assemble the empty actuator. Measure endplay, backlash and running drag. Select shims without preloading mismatched bearing races.
4. Lay the actual cables into the guides. Manually traverse ±160° pan and −30°…90° tilt with a supported dummy load. The fixed tails below the clamps and the camera tilt service loop are **not fully modeled or collision-qualified**. Verify cable length, minimum bend, friction, strain relief, abrasion and connector access before allowing full motion.
5. Measure available running torque and step loss under cable drag and acceleration. The load report provides demand scenarios, not a verified motor capability curve.
6. Validate PLA temperatures and creep during the intended energized duty cycle. Configure current/duty and temperature limits from actual results. Commission homing/limits before powered unattended motion.

Full functional print release remains conditional on these gates. Geometry-only 3MF files are not Bambu machine profiles or ready-to-run G-code.
