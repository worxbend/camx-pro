# Mechanical project

Parametric, FDM-printable pan–tilt housing for an intact Anker PowerConf C200 and
two 28BYJ-48 steppers. Pan: 4:1 planetary actuator. Tilt: concealed 2:1 belt.

**P3 is an engineering fit prototype.** Parts are printed and fit-checked. Digital
checks do not prove loaded torque, cable behavior or PLA thermal performance.

**Downloads:** print plates, individual parts, printed substitutes and the full
prototype package are on the [p3.1 release](https://github.com/worxbend/camx-pro/releases/tag/p3.1).

## Layout

- `cad/`: build123d geometry, parameters and their provenance.
- `printed_hardware/`: optional printed replacements for purchased hardware.
- `tools/`: export, motion, interface, mesh, print and packaging tools.
- `tests/`: mechanical and tool regression tests.
- `docs/`: assembly, BOM, wiring, measurements and verification.
- `references/`: reference images; `photos/` holds the hardware photos.
- `exports/`: generated STEP/STL/3MF/GLB, drawings, renders and reports. Ignored by Git.

## Mechanism and printer

- Pan: 20T sun, four 20T planets, fixed 60T ring. Two independent 6809
  bearings, captured planet bearings, located steel sleeves.
- Tilt: concealed 20T/40T belt, bearing-supported 28 mm steel trunnions,
  captured-nut clamps, defined axial spacer stack.
- Enclosure: nominal 160 × 160 mm sections, 89.5 mm base height, 3 mm wall.
  Camera pivot at Z154.5. Export manifests record actual bounds.
- Base columns: four cable-guide columns with flared, gusseted roots.
- Cables: separate rolling layers, removable guides, split ceilings, strain
  relief. Fixed tails and the tilt loop need trials with the actual cables.
- Printer: Bambu Lab A1 mini, 180 × 180 × 180 mm, PLA, 0.4 mm nozzle assumed.

[Anker's data](docs/c200-manufacturer-data.md) gives about 55 × 51 × 41 mm and
83 g. Dimension axes, folded clip, connector and center of gravity are still
provisional. Measure them before a full-size fit print.

## Setup

From the repository root (uv, CPython 3.14, pinned `requirements-audit.txt`):

```sh
make setup-hardware
make test-hardware
make export-hardware
```

## Commands

All CAD modules and tools run from `hardware/`:

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
.venv/bin/python -m tools.check_interference
.venv/bin/python -m tools.drawings
.venv/bin/python -m tools.render_cables
.venv/bin/python -m tools.package
.venv/bin/python -m tools.verify_preprint_package
.venv/bin/python -m tools.stage_viewer
```

- `tools.package` refuses missing, failed or stale CAD reports.
- `tools.verify_slicing` needs PrusaSlicer 2.9.4 (not in the Python lock). Its
  configuration audits geometry only. Print with Bambu Studio and the real A1
  mini/PLA profile. Geometry-only 3MFs hold no machine settings or G-code.

## Docs

- [Status](docs/status.md) and [verification record](docs/p3-verification.md)
- [Assembly](docs/assembly.md), [BOM](docs/bom.csv), [wiring](docs/wiring.md)
- [Measurements](docs/measurements.md), [C200 data](docs/c200-manufacturer-data.md)
- [Planetary actuator](docs/planetary-actuator.md), [motor placement](docs/motor-placement.md)
- [Control contract](docs/control-contract.md), [printed substitutes](docs/printed-hardware.md)

Start with the fit coupon. The [CAD viewer](../apps/site/) uses these exports.
`make check-contract` checks firmware constants against `cad/parameters.json`
through [`tools/contracts/firmware.py`](../tools/contracts/firmware.py). Run it after
parameter changes.
