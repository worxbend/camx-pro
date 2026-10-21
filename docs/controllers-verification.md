# Controller and website verification

Validated on 21 October 2026. These checks exercise software and exported CAD;
no ESP32 was flashed and no motor or camera was moved.

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
