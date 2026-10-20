# CAMX Pro

Parametric, FDM-printable pan–tilt camera housing for an intact **Anker PowerConf C200**, two owned 28BYJ-48 steppers, ULN2003 drivers and an ESP32. The selected design retains the professional U-body and adds a coaxial 4:1 planetary pan actuator.

**P3 engineering fit prototype.** The sixteen P2 findings have corresponding design corrections and regression probes. Read the [closure register](docs/p3-design-closure.md), [verification report](docs/p3-verification.md) and current `exports/reports/` results. Physical fits, PLA heat/creep, motor capability and real-cable behavior remain qualification gates. This is not a production-qualified print release.

![P3 CAD](docs/images/p3-three-quarter.png)

## Website and remotes

[Project page](https://worxbend.github.io/camx-pro/) · [3D CAD viewer](https://worxbend.github.io/camx-pro/viewer.html) · [Remote demo](https://worxbend.github.io/camx-pro/control/?demo=1)

```sh
npm ci
npm run build:remote
CAMX_DEVICE_URL=http://DEVICE_IP npm run bridge
# Open http://127.0.0.1:4175/control/ and enter the configured API token.

# Glyphora terminal remote (JDK 25)
cd apps/tui
./mill app.run --demo
./mill app.run --url http://DEVICE_IP
```

The hosted remote is a simulation. Live operation uses a localhost bridge or the
terminal client. Both require manual physical reference and explicit arming;
no camera is automatically moved on connection. See [controller instructions](docs/controllers.md)
the [verification record](docs/controllers-verification.md),
and the [monorepo architecture](docs/architecture.md).

To reproduce the complete website without rebuilding CAD:

```sh
python3 tools/site_assets.py fetch
npm ci
npm run build
npm test
npm run test:model
node apps/site/scripts/verify-site.mjs
npx playwright install chromium
npm run test:browser
```

The site output is `apps/site/dist/`. [Pages deployment](docs/pages.md) publishes
that tested artifact. Solid 2 is pinned to RC.16; Glyphora uses published 0.20.0.

## Design and printer

- Pan: 20T sun, four 20T planets and fixed 60T ring; two independent 6809 bearings, captured planet bearings and located steel sleeves.
- Tilt: concealed 20T/40T belt drive, bearing-supported 28 mm steel trunnions, captured-nut clamps and a defined axial spacer stack.
- Enclosure: 160×160 mm nominal sections, 89.5 mm height, 3 mm offset wall. Camera pivot Z154.5; actual bounds are recorded in the manifest.
- Cables: separate rolling layers with removable guide sections, split ceilings and strain relief. Fixed tails and the tilt loop still require actual-cable assembly trials.
- Printer: Bambu Lab A1 mini, 180×180×180 mm, PLA; **0.4 mm nozzle assumed** from the owner's “4mm” message. Confirm before slicing. Geometry-only 3MFs contain no printer settings or G-code.

[Anker's manufacturer data](docs/c200-manufacturer-data.md) gives approximately 55×51×41 mm and 83 g. Dimension axes, folded clip, connector and center of gravity remain provisional in CAD. Measure these interfaces before full-size fit printing.

## Reproduce and verify

Validated local tooling uses CPython 3.14, build123d 0.13 and Node 24. Install the locked audit dependencies:

```sh
uv venv --python 3.14 .venv
uv pip sync --python .venv/bin/python requirements-audit.txt
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
npm ci
npm run build
node apps/site/scripts/verify-model.mjs
```

Replace the slicer path with an installed PrusaSlicer executable. Its included configuration audits geometry only; use Bambu Studio with the actual A1 mini/PLA profile for printing. Successful slicing does not prove strength or support removal. Packaging refuses missing, failed or stale CAD verification reports.

Run `npm --workspace @camx/site run dev` for the local CAD viewer. It inspects the model and animates its mathematical joints; it cannot command physical motors. Rendering uses headless EGL/Mesa. Drawing and package tools produce SVG/PDF, actual-CAD PNGs, checksums and a reproducible ZIP.

## Maintained files

| Path | Purpose |
|---|---|
| `cad/` | Modular geometry, dimensions, provenance and cable centerlines |
| `tests/`, `tools/` | Regression tests, geometry/motion/mesh/slice checks and exporters |
| `docs/` | Closure register, measurements, assembly, BOM, wiring and control contract |
| `apps/site/` | Project page and interactive Three.js CAD inspector |
| `apps/remote/`, `apps/tui/` | Solid.js 2 web remote and Scala/Glyphora terminal remote |
| `packages/`, `contracts/` | Shared browser session, local bridge and API compatibility fixture |
| `firmware/` | ESP32 stepper controller, browser remote and native C++ tests |
| `references/`, root photos | Supplied hardware and appearance references |
| `exports/` | Generated STEP/STL/3MF/GLB, SVG/PDF/PNG and validation evidence |

Start with the fit coupon and the [assembly sequence](docs/assembly.md), followed by the empty actuator and supported dummy-load tests. Full powered travel requires reference/limit commissioning, cable trials, measured torque and PLA thermal qualification.

## ESP32 firmware

The [firmware guide](firmware/README.md) covers the WROOM-32 pinout, build/flash commands and first-motion procedure. It implements geared half-step motion, acceleration/deceleration, authenticated HTTP and serial control, a browser remote, eight presets, calibration, manual reference and latched stops. Boot leaves motor coils off; initial travel is pan ±20° and tilt ±15°.

```sh
.venv/bin/python tools/test_firmware.py
.venv/bin/pio run -d firmware -e public
node tools/test_firmware_ui.mjs
```

Read the [API](docs/firmware-api.md) and [software verification record](docs/firmware-verification.md). The public build contains no network credentials. No hardware was flashed or moved during development; loaded motion and thermal checks remain necessary. The new remotes use this stepper API; existing camx/OBS clients still need an adapter. The P3 CAD archive is a separate historical manufacturing snapshot and does not include this firmware addition.

`AGENTS.md` is preserved. Generated artifacts and local P2 backups are ignored by Git. The historical [P2 audit](docs/preprint-audit.md) documents why this revision was necessary; its coordinates and results are not P3 evidence.
