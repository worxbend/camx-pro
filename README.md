# CAMX Pro

Printable pan–tilt head for an intact **Anker PowerConf C200** webcam. Two 28BYJ-48
steppers, ULN2003 drivers, one ESP32. A **4:1 planetary** drives pan; a **2:1
concealed belt** drives tilt inside a U-shaped frame.

[Project page](https://worxbend.github.io/camx-pro/) · [3D CAD viewer](https://worxbend.github.io/camx-pro/viewer.html) · [Remote demo](https://worxbend.github.io/camx-pro/control/?demo=1) · [Downloads (p3.1)](https://github.com/worxbend/camx-pro/releases/tag/p3.1)

![P3 CAD](hardware/docs/images/p3-three-quarter.png)

**Status: engineering prototype.** Parts are printed and fit-checked. Motors have
not been powered. Loaded torque, cable wear and PLA heat/creep still need bench
tests. See [production readiness](docs/production-readiness.md) and the
[P3 verification record](hardware/docs/p3-verification.md).

## Print it

Grab the [p3.1 release](https://github.com/worxbend/camx-pro/releases/tag/p3.1):

| Asset | Contents |
| --- | --- |
| `camx-pro-p3.1-print-plates.zip` | 17 Bambu A1 mini plates (3MF), ready to slice |
| `camx-pro-p3.1-parts-3mf.zip` | 47 printable parts, one 3MF each |
| `camx-pro-p3.1-printed-substitutes.zip` | Optional printed bearings, shafts and belt drive |
| `camx-pro-p3.1-prototype.zip` | STEP, STL, 3MF, drawings, reports, BOM, source snapshot |
| `camx-pro-p3.1-engineering.pdf` | Drawings, verification, assembly and wiring |
| `SHA256SUMS` | Checksums for every asset |

Geometry 3MFs carry no machine settings. Slice with your own PLA profile and a
0.4 mm nozzle. Start with the fit coupon. Then follow [assembly](hardware/docs/assembly.md)
and [wiring](hardware/docs/wiring.md).

## Features

- Firmware 1.1.0: jerk-limited moves with coordinated pan/tilt arrival, diagonal
  jogs, runtime motion feel, retargeting, named presets, last-pose hint.
- Authenticated HTTP and serial API, motion leases, latched faults, manual reference.
- Three remotes: the firmware's own panel, a web remote (via local bridge) and a
  terminal remote. Both remotes still work with 1.0.0 firmware.
- Parametric build123d CAD with interference, motion, cable, layer and slicing checks.

Coordinated arrival does not mean a straight diagonal path: unequal motion profiles
can bend it.

## Layout

```text
apps/site/          Website and Three.js CAD viewer
apps/remote/        Solid.js 2 web remote
apps/tui/           Scala 3 / Glyphora terminal remote
packages/control/   Web remote session, HTTP transport, demo simulator
packages/bridge/    Loopback host and ESP32 proxy
firmware/           PlatformIO project: portable C++17 core, ESP32 adapter, panel, tests
hardware/           build123d CAD, mechanical tests, audit tools, engineering docs
contracts/          Firmware-generated state fixture shared by every client test
tests/integration/  Playwright scenarios against the real C++ controller
tools/              Contract generation, website assets, release packaging
docs/               Architecture, controllers, Pages and release notes
```

Each project owns its source, tests, config and generated output. Dependency rules:
[architecture](docs/architecture.md).

## Run

Node 24, Python 3.11+, JDK 25 (TUI), uv + Python 3.14 (CAD), PlatformIO (firmware).

```sh
npm ci
npm run build:remote
CAMX_PRO_DEVICE_URL=http://DEVICE_IP npm run bridge
# Open http://127.0.0.1:4175/control/ and enter the ESP32 API token.
```

The hosted remote is an offline demo. Live control goes through the loopback bridge
or the TUI. Connecting never arms or references the mechanism. Guide: [controllers](docs/controllers.md).

```sh
cd apps/tui
./mill app.run --demo
./mill app.run --url http://DEVICE_IP
```

Firmware setup and flashing: [firmware/README.md](firmware/README.md). CAD:
[hardware/README.md](hardware/README.md).

## Build and test

`make help` lists the shared targets. Run from the repository root.

| Command | Does |
| --- | --- |
| `make check` | Formatting, CAD/firmware contract, website asset tests |
| `make test-firmware` | Native C++ suites with ASan/UBSan (`CXX=g++` selects GCC) |
| `make build-firmware` | Public ESP32 build; `python firmware/tools/check_variants.py` builds the variants |
| `npm test` | Node unit tests |
| `node firmware/tools/test_ui.mjs` | Firmware panel in Chromium |
| `make website` then `make test-web` | Pages build, then Node and browser integration tests |
| `make test-tui` / `make build-tui` | Glyphora tests / runnable JAR |
| `make setup-hardware`, `make test-hardware`, `make export-hardware` | CAD environment, tests, exports |

Browser tests need `npx playwright install chromium`. TUI packaging checks:
`python3 apps/tui/scripts/test_pty.py` and `python3 apps/tui/scripts/test_environment.py`.

## Release

1. Export and verify the CAD: the full tool list is in [hardware/README.md](hardware/README.md).
2. `python3 tools/release.py <tag>` writes every asset to `release/<tag>/`. It refuses
   stale exports or failed package/slicing reports.
3. Commit the updated `apps/site/assets.lock.json`, then publish:
   `gh release create <tag> release/<tag>/*`.

Never replace an asset under an existing lock; cut a new tag. Details: [Pages](docs/pages.md).

## Conventions

- Standalone: no imports, symlinks or build steps that reach outside this repository.
  Local npm packages use `@camx-pro/*`; app environment variables use `CAMX_PRO_*`.
- Generated output stays out of Git: `hardware/exports/`, `release/`, app `dist/`,
  `apps/tui/out/`, `firmware/.pio/`, `firmware/include/web_ui.hpp`.
- `firmware/include/camx/mechanics.hpp` is generated by `tools/contracts/firmware.py`
  and committed. Never edit it by hand.
- Style: Prettier (two spaces) for JS/JSON/CSS/HTML; `firmware/.clang-format` for C++
  (LLVM base, four spaces, 100 columns); Scala 3 significant indentation with
  `-Wunused:all -Werror`.
- Tests ship with every behavior change, next to the owning project. A change to the
  firmware state document regenerates `contracts/state-v1.json` from
  `firmware/tests/simulator.cpp` and keeps both remotes working on older firmware
  (`api_minor`). No automated test moves hardware.
- Record what was verified, and what was not, in the project's `docs/`.
- Commits: short imperative subject, one project or concern per commit.
- Secrets: Wi-Fi credentials and the API token live in the ignored
  `firmware/include/credentials.h` (copy `credentials.example.h`). Configured binaries
  contain them; keep them private. The bridge binds to loopback only.
