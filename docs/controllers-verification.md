# Controller and website verification

Validated on 21 October 2026. These checks exercise software and exported CAD;
no ESP32 was flashed and no motor or camera was moved.

## Standalone project configuration

Checked on 21 October 2026 after moving local npm packages to `@camx-pro/*`
and application configuration to `CAMX_PRO_DEVICE_URL`, `CAMX_PRO_PORT` and
`CAMX_PRO_API_TOKEN`. The implementation plan and contributor guidance now
define requirements within this repository, without sibling-checkout references.

- Lockfile regeneration and `npm ci` succeeded. The workspace links resolve
  to packages inside this repository.
- `npm test`: 23 passed, including bridge CLI launches from an empty temporary
  working directory. An unrelated device variable does not configure a proxy;
  the explicit Pro variable reaches only the loopback fixture.
- `npm run assets:fetch`, `npm run build`, model verification and site-link
  verification passed. All 11 CAD downloads came from the pinned CAMX Pro release.
- `npm run test:browser`: all 7 scenarios passed against the C++ simulator.
- `./mill --no-server app.test`: all 12 Scala tests passed; assembly and the
  packaged PTY render/exit/restoration check passed.
- `python3 apps/tui/scripts/test_environment.py`: passed. From an empty temporary
  working directory, the packaged JAR rejects a noninteractive launch with only
  an unrelated token and accepts the Pro token against a loopback state fixture.
  This check is also included in the application CI workflow.
- Prettier, the CAD/firmware mechanical contract, all 3 asset-integrity tests and
  `git diff --check` passed.

Validation used Node 24 and JDK 25. CAD geometry regeneration, ESP32 builds and
hardware qualification were not rerun for this configuration/documentation change.
GitHub Actions has not run for these local changes.

## Firmware 1.1 client update

Checked on 21 October 2026 after both remotes gained the firmware 1.1.0 features
(diagonal jog and steps, motion feel, move speed, retargeting, named presets with
*Here* and clear, last-pose hint, jerk setting). No ESP32 was flashed and nothing moved.

| Check | Result |
| --- | --- |
| Node tests | 20 passed: the earlier session/bridge cases plus capability detection, validation of 1.1.0 fields and of 1.0.0 states without them, the demo's synchronized diagonal moves, scales, retarget, named presets, last pose, and a jog press, a command and a jog release meeting an in-flight poll or lease renewal (sent after it, not dropped or turned into STOP) |
| Playwright | 7 passed, including a new scenario on the real C++ controller: runtime feel, a diagonal step (46/23 half-steps), a held diagonal jog, retargeting to a new target, a named preset of the present pose, clearing it, and the last-pose hint; the 320 px layout check stays green |
| Remote on firmware 1.0.0 | Ad-hoc probe (not in CI): the remote served against the simulator built from commit `0b0a1c6` hid every 1.1.0 control; diagonal step and jog, a move and *Save* worked without errors |
| Glyphora/Scala tests | 12 passed (was 6): parsing with and without 1.1.0 fields, the demo's 1.1.0 commands, a headless run of diagonal keys and buttons, *Save here* with a typed name, clear, feel and *Use last pose*, all new controls visible at 76×27, 1.0.0 firmware hiding features and never sending them, and a step pressed during a blocked status poll |
| Packaged Glyphora JAR | Assembly, demo JSON (`api_minor` 1) and the real-PTY render/Ctrl+C/terminal-restoration check passed |
| Website | Build, 103-component model check, 30 local links/assets and 11 pinned CAD downloads, and the 3 asset-rejection tests passed |
| Hygiene | Prettier and `git diff --check` passed; actionlint and the npm audit were not rerun |

Environment notes: tests ran on Node 22 (CI uses Node 24); Playwright 1.55 was pointed at
the preinstalled Chromium build; the TUI used JDK 25 with the JVM Mill launcher
(`MILL_VERSION=1.1.9-jvm`) because the native launcher did not trust the local TLS proxy,
and Maven Central rate limiting needed retries. GitHub Actions did not run for this change.

## Local evidence: initial controllers

| Check | Result |
| --- | --- |
| Node session/HTTP bridge tests | 12 passed: ordering, STOP races, rejected sequences, timeouts, heartbeat ownership, jog lease and local-origin boundaries |
| Playwright application checks | 6 passed: project-prefix links, lazy viewer, 103-part model/motion controls, mobile layout, WebGL/model failure states, Solid remote against C++ firmware, demo/blur STOP |
| Glyphora/Scala tests | 6 passed: shared API fixture, session epochs, late ARM suppression, HTTP framing/redirect handling, headless operator flow and small-terminal state |
| Packaged Glyphora JAR | Demo JSON output and real PTY rendering, Ctrl+C exit and terminal-attribute restoration passed |
| Pinned CAD bundle rejection | 3 passed: corrupt checksum, changed allowlist and archive traversal rejected before staging |
| Existing firmware browser panel | Original C++ fixture-backed browser regression passed after the workspace move |
| CAD/firmware generated contract | Exact mechanical constants check passed; pan 4:1 and tilt 2:1 |
| CAD viewer model | All 103 GLB components, coordinate conversion, combined-axis pivots, tilt drive and planet orbits passed |
| Website composition | 30 local HTML assets/links and all 11 pinned CAD downloads present |
| Build hygiene | Prettier, actionlint, whitespace checks, Python compilation and npm dependency audit passed |

Production browser builds use Solid 2.0.0-rc.16 and Vite 8.3.4. The TUI uses
published Glyphora 0.20.0, Scala 3.9.0, Mill 1.1.9 and JDK 25. The CAD source
fingerprint remains unchanged from the verified P3 export. `AGENTS.md` was not
modified at that time (the 1.1 update rewrote it to describe the established layout). Sources and lockfiles are committed; generated outputs and credentials
remain ignored.

## Scope

The browser test compiles and runs `firmware/tests/simulator.cpp`, the actual
portable C++ controller, and checks the emitted geared step counts. HTTP bridge
and TUI network tests use loopback fixtures. UI demos are intentionally synthetic;
they do not qualify mechanics, electrical behavior or motion timing on an ESP32.

Real-device Wi-Fi loss, GPIO output, switch wiring, load torque, cable behavior
and thermal operation still require the documented commissioning procedure.
Both remotes keep explicit reference/arm steps and use best-effort STOP plus the
firmware watchdog. Browser background throttling, radio loss, process termination
and a disconnected power supply cannot be made into guaranteed STOP delivery by
a client application.

## GitHub Actions evidence

- [Clean passing application run](https://github.com/worxbend/camx-pro/actions/runs/39500629815)
  at `b61e476`: both web and TUI jobs passed. The runner downloaded and checked
  the released CAD bundle; no local export directory was needed. Topic-branch
  deployment was skipped as intended.
- [Deliberate failure run](https://github.com/worxbend/camx-pro/actions/runs/39501011339):
  an isolated temporary test failed at `npm test`, and all subsequent build and
  Pages artifact-upload steps were skipped. The failure commit is excluded from
  `main`. The deploy job also requires both application jobs to succeed.
- Job logs show **Contents: read** and **Metadata: read** for both validation jobs.
  Deployment permissions are confined to the trusted main-branch Pages job.

The original prototype workflow still validates mechanical and embedded targets
separately. Its long geometry checks do not gate a documentation-only Pages
publication; the Pages build instead verifies the pinned P3 CAD source hash.

## Joystick remote verification — 21 October 2026

The remote now has a draggable circular joystick with a 16% center dead zone,
proportional axis fractions in 5% increments and 25/50/100% speed caps. Mouse,
touch and arrow-key chords use one latest-intent coordinator over the existing
Session. Firmware changes are not required: a new vector brakes first and starts
only when the authoritative state reports idle. Release discards queued intent.

- 29 Node tests pass, including joystick vector bounds, coalescing, release during
  a pending request, release before a poll returns, braking, STOP, ownership loss
  and failed exchanges.
- Five browser joystick regressions pass against the portable C++ controller:
  proportional and diagonal movement, direction changes, release outside the pad,
  release while an accepted command response is delayed, keyboard chords and
  repeat use after braking, focus loss, Escape, pointer-capture loss, window blur,
  and Chromium touch drag/cancellation. The full browser suite passes all 15
  scenarios, including the microsite, CAD viewer and existing remote workflows.
- Production build, Prettier, whitespace and local link/asset checks pass.
  Desktop and phone screenshots were reviewed; the preview console was clean.
- Physical motors remain untested. Browser tests run against a host fixture;
  touchscreen input is browser-emulated, not a physical-device qualification.
