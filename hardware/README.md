# Mechanical project

Parametric, FDM-printable PTZ housing for the intact Anker PowerConf C200, two
28BYJ-48 steppers, a 4:1 pan planetary actuator and a concealed 2:1 tilt belt.
**P3 is an engineering fit prototype.** Digital checks do not establish real
hardware fit, loaded torque, cable behavior or PLA thermal performance.

## Layout

- `cad/`: build123d geometry, dimensional parameters and provenance.
- `tools/`: geometry, motion, interface, mesh, print and packaging utilities.
- `tests/`: mechanical and audit-tool regression tests.
- `docs/`: assembly, BOM, wiring, measurements and engineering evidence.
- `references/`: supplied reference images; `photos/` contains the hardware photos.
- `exports/`: ignored STEP/STL/3MF/GLB, drawings, renders and verification reports.
- `PLAN.md`: original engineering brief, architecture decisions and execution plan.

## Mechanism and printer

- Pan: 20T sun, four 20T planets and fixed 60T ring; two independent 6809
  bearings, captured planet bearings and located steel sleeves.
- Tilt: concealed 20T/40T belt, bearing-supported 28 mm steel trunnions,
  captured-nut clamps and a defined axial spacer stack.
- Enclosure: nominal 160 × 160 mm sections, 89.5 mm base height and 3 mm wall;
  camera pivot at Z154.5. Export manifests record actual bounds.
- Cables: separate rolling layers, removable guides, split ceilings and strain
  relief. Fixed tails and the tilt loop need actual-cable assembly trials.
- Printer: Bambu Lab A1 mini, 180 × 180 × 180 mm build volume, PLA.

[Anker's data](docs/c200-manufacturer-data.md) gives approximately 55 × 51 × 41 mm
and 83 g. Dimension axes, folded clip, connector and center of gravity remain
provisional. Measure these interfaces before a full-size fit print.

## Setup and development

From the repository root:

```sh
make setup-hardware
make test-hardware
make export-hardware
```

These use `uv`, CPython 3.14 and the pinned `requirements-audit.txt`. Alternatively,
work inside `hardware/`; all CAD modules and audit tools run from this directory:

```sh
cd hardware
.venv/bin/python -m pytest -q
.venv/bin/python -m cad.export
.venv/bin/python -m tools.prepare_print_plates
.venv/bin/python -m tools.validate_artifacts
.venv/bin/python -m tools.validate_motion
.venv/bin/python -m tools.verify_mechanical_interfaces
.venv/bin/python -m tools.verify_parameters_and_loads
.venv/bin/python -m tools.verify_dense_motion
.venv/bin/python -m tools.verify_cable_routing
.venv/bin/python -m tools.verify_print_layers
.venv/bin/python -m tools.verify_slicing --slicer /absolute/path/to/prusa-slicer
.venv/bin/python -m tools.drawings
.venv/bin/python -m tools.render_cables
.venv/bin/python -m tools.package
.venv/bin/python -m tools.verify_preprint_package
.venv/bin/python -m tools.stage_viewer
```

Packaging refuses missing, failed or stale required CAD reports. The slicer
configuration audits geometry only; use Bambu Studio with the actual A1 mini/PLA
profile for printing. Geometry-only 3MFs contain no machine settings or G-code.
The expected nozzle is **0.4 mm**, assumed from the original “4mm” message.

The CAD source bytes and P3 fingerprint were preserved during the monorepo move.
Existing P3 release ZIPs retain their historical paths. Newly generated packages
use the current monorepo layout. See the [closure register](docs/p3-design-closure.md),
[verification record](docs/p3-verification.md), [measurements](docs/measurements.md)
and [assembly sequence](docs/assembly.md). Begin with the fit coupon.

The [CAD viewer](../apps/site/) consumes these generated artifacts. Firmware
constants are checked against `cad/parameters.json` by
[`tools/contracts/firmware.py`](../tools/contracts/firmware.py); run
`make check-contract` from the repository root after parameter changes.
