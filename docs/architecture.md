# Monorepo organization

CAMX Pro has independently buildable mechanical, embedded, browser and terminal
projects. Keep hardware control separate from geometry inspection.

| Directory | Responsibility | Build/test owner |
| --- | --- | --- |
| `hardware/` | Parametric build123d geometry, mechanical tests, engineering docs and reference photos | Python / `hardware/pyproject.toml` |
| `firmware/` | ESP32 adapter, portable C++ motion engine, embedded fallback panel | PlatformIO / native C++ tests |
| `apps/site/` | Project overview and Three.js CAD inspector | npm workspace `@camx/site` |
| `apps/remote/` | Solid.js 2 browser remote and demo | npm workspace `@camx/remote` |
| `apps/tui/` | Scala/Glyphora terminal remote | Pinned Mill build |
| `packages/control/` | Web remote's session ordering, HTTP transport and UI simulator | Node tests |
| `packages/bridge/` | Loopback-only static host and bounded ESP32 proxy | Node HTTP tests |
| `contracts/` | Firmware-generated JSON compatibility fixture | JS and Scala consumers |
| `tests/integration/` | Browser scenarios and firmware-backed HTTP fixture | Playwright / native C++ |
| `tools/contracts/` | CAD-to-firmware constant generation and checking | Python, standard library only |
| `tools/website/` | Pinned release asset staging and Pages composition | Python / Node |
| `docs/` | Cross-project architecture, controller operation and publishing | Maintained source |
| `hardware/exports/`, `release/`, app `dist/`, TUI `out/` | Generated artifacts | Ignored by Git |

## Placement and dependency rules

- Keep project-specific source, tests, documentation and tooling inside its
  project. Mechanical audits belong in `hardware/tools/`; native firmware checks
  belong in `firmware/tools/`; terminal checks belong in `apps/tui/scripts/`.
- JavaScript packages use `src/` and `test/`. Import public package
  exports (for example `@camx/control`), not another project's internal files.
- Put tests that exercise multiple projects in `tests/integration/`. Keep
  compatibility fixtures in `contracts/` and generate them from the firmware.
- Use root `tools/` only for automation that crosses project boundaries. Keep
  engineering references in `hardware/references/`, not beside root configuration.
- Add a root Make target or npm script for common workflows; keep tool-specific
  configuration in the owning project. Do not commit generated exports or caches.

## Toolchains and working directories

Use one root npm lockfile and install from the root with `npm ci`. Workspace
commands are exposed in the root package manifest. Python and Mill keep their
own pinned dependency systems; JavaScript workspaces do not own CAD or firmware.
Run Python CAD modules from `hardware/` using `hardware/.venv`;
`make setup-hardware`, `make test-hardware` and `make export-hardware` handle this from
the repository root. Run PlatformIO with `pio run -d firmware -e public` and
Mill from `apps/tui/`. `make help` lists the root entry points.

JavaScript, JSX, JSON, CSS and HTML use the root Prettier configuration (two-space
indentation); run `npm run format:check` or `npm run format`. Scala uses the
Scala 3 significant-indentation style; C++ retains the firmware clang-format rules.
`AGENTS.md` summarizes this layout and the common commands for coding agents; update
it together with this document and the README.

## Interfaces and publishing

The [firmware API](../firmware/docs/api.md) is the shared language-independent control contract.
The web app imports `@camx/control` (its only consumer today); the Scala client
implements the same contract and tests the same firmware-generated state fixture.
Both read `api_minor` and offer firmware 1.1.0 features only when the device reports
them; with 1.0.0 firmware they hide those features and never send their commands. Its controls use degree
units, never raw coil phases or servo pulses. The mechanical constants flow from
`hardware/cad/parameters.json` through `tools/contracts/firmware.py` into the C++ build.

The website build composes the remote at `/control/` and the inspector at
`/viewer.html`. Public hosting exposes a demo, not a motor API. Live browser
control uses `browser → localhost bridge → ESP32`; TUI control uses `TUI → ESP32`.
Neither client carries webcam video. See [controller operation](controllers.md)
and [Pages publishing](pages.md).

CI separates mechanical validation, embedded builds, application tests, and
trusted Pages deployment. Website CAD downloads are tied to a versioned release
asset by size, SHA-256 and CAD source digest; a fresh runner does not depend on
an ignored local export folder. Changing geometry requires verified exports and
a newly pinned asset release. Existing P3 verification documents and manufacturing
ZIPs are historical snapshots and are not silently rewritten by UI changes.

## Migration from the flat layout

`cad/`, mechanical `tests/` and mechanical `tools/` moved together into
`hardware/`; their module names remain unchanged. Python dependencies and
`PLAN.md` moved with them. Hardware photos now live in
`hardware/references/photos/`. Firmware API/verification docs moved into
`firmware/docs/`. The root `AGENTS.md` and the CAD source bytes were preserved.
New manufacturing archives mirror the monorepo layout; the verifier also accepts
the historical P3 archive layout. Website URLs and pinned release assets remain
stable.
