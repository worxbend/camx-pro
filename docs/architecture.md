# Monorepo organization

CAMX Pro has independently buildable mechanical, embedded, browser and terminal
projects. Keep hardware control separate from geometry inspection.

| Directory | Responsibility | Build/test owner |
| --- | --- | --- |
| `cad/` | Parametric build123d geometry and measured/provisional parameters | Python / `pyproject.toml` |
| `firmware/` | ESP32 adapter, portable C++ motion engine, embedded fallback panel | PlatformIO / native C++ tests |
| `apps/site/` | Project overview and Three.js CAD inspector | npm workspace `@camx/site` |
| `apps/remote/` | Solid.js 2 browser remote and demo | npm workspace `@camx/remote` |
| `apps/tui/` | Scala/Glyphora terminal remote | Pinned Mill build |
| `packages/control/` | Browser session ordering, HTTP transport and UI simulator | Node tests |
| `packages/bridge/` | Loopback-only static host and bounded ESP32 proxy | Node HTTP tests |
| `contracts/` | Firmware-generated JSON compatibility fixture | JS and Scala consumers |
| `tests/` | Python mechanical regressions and `web/` integration tests | pytest / Playwright |
| `tools/` | Export, validation, packaging, website assets and fixture tooling | Repository automation |
| `docs/`, `references/` | Engineering/operator documentation and supplied references | Maintained source |
| `exports/`, `release/`, app `dist/`, TUI `out/` | Generated artifacts | Ignored by Git |

Use one root npm lockfile and install from the root with `npm ci`. Workspace
commands are exposed in the root package manifest. Python and Mill keep their
own pinned dependency systems; JavaScript workspaces do not own CAD or firmware.
JavaScript, JSX, JSON, CSS and HTML use the root Prettier configuration (two-space
indentation); run `npm run format:check` or `npm run format`. Scala uses the
Scala 3 significant-indentation style; C++ retains the firmware clang-format rules.
The original `AGENTS.md` is intentionally preserved; this document and README
record the now-established layout and commands.

The firmware API document is the shared language-independent control contract.
The web app imports `@camx/control`; the Scala client implements the same contract
and tests the same firmware-generated state fixture. Its controls use degree
units, never raw coil phases or servo pulses. The mechanical constants flow from
`cad/parameters.json` through `tools/firmware_contract.py` into the C++ build.

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
