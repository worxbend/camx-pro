# P3 planetary pan actuator

The owned 28BYJ-48 drives a 20T sun. Four 20T planets run within a fixed 60T ring, producing carrier output at 4:1 reduction. Module is 1.25 mm; pressure angle 20°; provisional total backlash 0.30 mm. Tooth profiles and phases are generated from `cad/transmissions.py` and `cad/planetary.py`.

For carrier angle θ, sun angle is 4θ and each planet rotates −3θ relative to the carrier. Equal planet spacing is valid because (60+20)/4 is an integer. Neutral planet phase is `angle*(1+20/20)+180/20`; preserve the named placements when assembling.

## Load paths and retention

Two 6809 bearings carry the upper assembly independently of the motor shaft. The output journal is nominally 44.85 mm; bearing pockets use the shared diametral-clearance parameter. Bearing spans are Z49–56 and 61–68. Both race spacers are 5 mm long. Inner shoulders at 48.9 and 68.1 provide 0.2 mm total nominal endplay. The housing contacts the ring at Z37; the ring contacts base columns at26.5.

Each planet's outer race is captured by a lower shoulder and a separate four-screw cap. Steel 8 mm sleeves, 14.5 mm long, register in 8.05 mm carrier pilots. The lower 0.2 mm shim and upper 6.7 mm spacer contact inner races. M3 screws supply clamp force; their clearance holes do not locate the planets. Load the M1.6 nuts radially before fitting caps. Verify purchased nut/head envelopes.

The sun journal cap retains its inner race. Its bearing can float in the removable cartridge; the cartridge is not an output thrust stop. Cartridge mounting screws have open head/driver wells. The housing posts are relieved to R40 across the rotating planet-collar sweep. Motor heads fit below a continuous swept relief in the lower carrier.

## Validation and limits

Run the mechanical-interface probes, dense gear-profile sweep, rigid motion checks and parameter/load report. Exact source hashes prevent stale validation from being presented as current. Profile nonintersection does not establish tooth strength, fatigue, equal planet loading or measured backlash.

PLA fits, race-contact widths, sleeve tolerances and screw lengths require coupons and measured hardware. The existing geared motor remains slow and has internal backlash. Added reduction increases torque demand margin at the expense of output speed; it does not create an industrial precision actuator. Qualify actual load, cable friction, temperature and service life before full motion.
