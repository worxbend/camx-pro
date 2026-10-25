# Monorepo organization

CAMX Pro has independently buildable mechanical, embedded, browser and terminal
projects. Hardware control stays separate from geometry inspection.

The repository owns its source, device protocol, configuration and release
lifecycle. A fresh checkout builds with its declared toolchains and package
dependencies. No sibling checkout, cross-repository symlink or external generated
output is needed. Website CAD downloads come from this repository's pinned
releases and can be regenerated from `hardware/`.

- npm packages use the `@camx-pro/*` scope.
- The bridge reads `CAMX_PRO_DEVICE_URL` and `CAMX_PRO_PORT`. The terminal remote
  reads `CAMX_PRO_API_TOKEN`. Unscoped variables are not fallbacks.
- Device settings use the `camx-pro-v1` NVS namespace. Browser tokens stay in memory.
- Compatibility promises cover CAMX Pro's own versioned API only.

| Directory | Responsibility | Build/test owner |
| --- | --- | --- |
| `hardware/` | Parametric build123d geometry, mechanical tests, engineering docs and reference photos | Python / `hardware/pyproject.toml` |
| `firmware/` | ESP32 adapter, portable C++ motion engine, embedded fallback panel | PlatformIO / native C++ tests |
| `apps/site/` | Project overview and Three.js CAD inspector | npm workspace `@camx-pro/site` |
| `apps/remote/` | Solid.js 2 browser remote and demo | npm workspace `@camx-pro/remote` |
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

- Project source, tests, docs and tooling live inside the project. Mechanical
  audits go in `hardware/tools/`, native firmware checks in `firmware/tools/`,
  terminal checks in `apps/tui/scripts/`.
- JavaScript packages use `src/` and `test/`. Import public package exports
  (for example `@camx-pro/control`), never another project's internal files.
- Cross-project tests go in `tests/integration/`. Compatibility fixtures go in
  `contracts/` and are generated from the firmware.
- Root `tools/` is only for automation that crosses project boundaries.
  Engineering references live in `hardware/references/`.
- Common workflows get a root Make target or npm script. Tool-specific
  configuration stays in the owning project. Never commit generated exports or caches.

## Toolchains and working directories

- One root npm lockfile. Install from the root with `npm ci`. The root manifest
  exposes workspace commands.
- Python and Mill keep their own pinned dependency systems. JavaScript workspaces
  do not own CAD or firmware.
- Run Python CAD modules from `hardware/` with `hardware/.venv`. From the root,
  `make setup-hardware`, `make test-hardware` and `make export-hardware` do this.
- PlatformIO: `pio run -d firmware -e public`. Mill: run from `apps/tui/`.
- `make help` lists root entry points. The root README lists all build and test commands.

Formatting: JavaScript, JSX, JSON, CSS and HTML use the root Prettier
configuration (two spaces); run `npm run format:check` or `npm run format`.
Scala uses Scala 3 significant indentation. C++ follows `firmware/.clang-format`.

## Interfaces and publishing

The [firmware API](../firmware/docs/api.md) is the shared, language-independent
control contract.

- The web app imports `@camx-pro/control`, its only consumer. The Scala client
  implements the same contract and tests the same firmware-generated state fixture.
- Both clients read `api_minor`. They offer firmware 1.1.0 features only when the
  device reports them. With 1.0.0 firmware they hide those features and never
  send their commands.
- Controls use degrees, never raw coil phases or servo pulses.
- Mechanical constants flow from `hardware/cad/parameters.json` through
  `tools/contracts/firmware.py` into the C++ build.

The website build composes the remote at `/control/` and the inspector at
`/viewer.html`. Public hosting exposes a demo, not a motor API. Live browser
control is `browser → localhost bridge → ESP32`; TUI control is `TUI → ESP32`.
Neither client carries webcam video. See [controller operation](controllers.md)
and [Pages publishing](pages.md).

CI runs mechanical validation, embedded builds, application tests and trusted
Pages deployment as separate jobs. Website CAD downloads are pinned to a
versioned release asset by size, SHA-256 and CAD source digest, so a fresh runner
needs no local export folder. A geometry change needs verified exports and a new
release; see [releases](pages.md#releases).
