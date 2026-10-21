# Firmware local verification — 20 October 2026

CAMX Pro 1.0.0 is implemented for ESP32-WROOM-32, two ULN2003-driven
28BYJ-48 motors, the 4:1 planetary pan actuator and 2:1 tilt belt drive.
This record covers software checks. No board was flashed, powered movement
performed or mechanical/thermal qualification inferred from compilation.

## Completed checks

| Check | Result |
|---|---|
| CAD/firmware contract | Generated ratios, travel envelope, nominal step count and motion ceilings match `hardware/cad/parameters.json` |
| Native C++ suites | Five executables pass with Clang, `-Wall -Wextra -Wpedantic -Werror`, AddressSanitizer and UndefinedBehaviorSanitizer |
| Motion stress | 300 deterministic randomized dual-axis trajectories; 196,435 emitted half-steps |
| Timing/trajectory invariants | 230–270 µs jitter and 251 µs ticks; step interval ≥1250 µs, acceleration/speed bounds, phase/reversal, limits, final positions and 64-bit clock crossing checked |
| State handling | Boot/release outputs, reference/arm, STOP latch, watchdog, jog expiry, stale epochs/sequences, fractional relative moves, timing-fault position invalidation |
| Protocol stress | 50,000 mutated/truncated JSON packets and 30,000 mutated HTTP requests, plus explicit duplicate, malformed, oversized, partial and authentication cases |
| Persistence | 231-byte settings round-trip, corruption at every byte, invalid booleans and changed mechanical fingerprint with recomputed CRC; failed loads leave state untouched |
| Public ESP32 build | Pass: 57,348 / 327,680 bytes static RAM (17.5%); 798,629 / 1,310,720 bytes application flash (60.9%) |
| Configured compile fixture | Pass with fake Wi-Fi credentials and GPIO32 stop enabled; temporary binary removed, no upload |
| Chromium remote | Connect, reference, arm, geared move, pointer jog/release, STOP during delayed response, preset saving, no token storage and 390 px layout pass |
| Maintenance | CAD constant drift check, C++ formatting, Python syntax and source whitespace checks pass; CI workflow added |

Browser tests use the real portable C++ controller in a host fixture. They do
not execute the ESP32 adapter, exercise radio behavior, or measure actual GPIO
timing. Mutation testing is bounded and does not constitute exhaustive parser
or security coverage. CI is configured but was not run remotely.

## Firmware 1.1.0 — 21 October 2026

Version 1.1.0 keeps API v1 and adds optional fields and operations. Changes: jerk-limited
S-curve profiles (`profile.hpp`) with a per-axis `jerk` setting; stops planned from the
present speed and acceleration; synchronized pan/tilt arrival; runtime `motion` scales and
per-move `speed`; opt-in retargeting; `eta`, `queued`, `accel_now` and `max_tick_cost_us`
diagnostics; named presets, `preset_save`/`preset_clear` and a persisted last-pose hint;
settings blob version 2 with reading of version 1 blobs; embedded panel controls for all of
it. Jog release now takes longer (about 0.5–0.7 s from full speed) than the trapezoid's
stop. The host fixture's arithmetic is exact IEEE double; the ESP32 emulates doubles in
software, so planning and per-step time-search cost is **not** established by these checks.

| Check | Result |
|---|---|
| Native C++ suites | Seven executables pass with Clang 18, `-Wall -Wextra -Wpedantic -Werror`, AddressSanitizer and UndefinedBehaviorSanitizer (the CI invocation); also pass with GCC 13 |
| Profile properties | 4,000 random rest-to-rest profiles over every regime (speed-limited and acceleration-limited ramps, with and without cruise): speed, acceleration and jerk ceilings, central-difference derivatives, monotonic position, closed-form durations, exact time stretching, 240,000 inverse lookups from arbitrary hints; 120,000 stops from random mid-move states end at rest within their ceilings and never need more distance than the move had left |
| Motion stress | The 1.0.0 trajectories (300 random dual-axis moves, 188,767 emitted half-steps, 230–270 µs jitter, 64-bit clock crossing) now also check per-tick acceleration and jerk bounds |
| Controller features | Synchronized arrival and straightness, runtime and per-move scales, retarget/relative/repeat/STOP/jog/disarm interactions, ETA, and 1,440 randomized events (1,064 mid-move retargets and brakes) under timer jitter with every tick audited for speed, acceleration, jerk, continuity, limits, step spacing and faults |
| Test sensitivity | Mutants that halve the jerk bound, allow only one search round, or brake with doubled acceleration all fail the suites; removing the 1 µs rebase margin does not (it is a safety margin the simulation does not exhaust) |
| Protocol | New operations and option validation; 60,000 mutated commands executed (not only parsed) with sanitizers and invariants on scales, names, poses, limits; worst-case status JSON (all presets named, extreme values) is well-formed at about 1.6 KB of the 4,096-byte buffer, and truncation is reported as failure |
| Persistence | Version 2 round trip; every single-byte corruption; 19 resealed (valid-CRC) version 2 corruptions and 3 version 1 ones rejected without touching the device; version 1 blobs produced by a byte-for-byte copy of the 1.0.0 encoder migrate with their presets and calibration, then re-encode and reload identically |
| ESP32 builds | Public build compiles with `-Werror`: RAM 60,268 bytes (18.4 %, was 57,348), flash 812,785 bytes (62.0 %, was 798,901, same toolchain), after the review fixes and panel changes below; the Wi-Fi + GPIO32 STOP fixture compiles |
| Browser | The firmware panel test (3 consecutive runs) covers motion scales, retargeting, named presets, saving the present pose, clearing, validation and the last-pose hint against the real C++ controller; the unchanged Solid remote passes its 6 integration tests against the 1.1.0 controller; 12 Node unit tests pass; `contracts/state-v1.json` was regenerated and is accepted by the JS session code and the integration fixture |

Not checked here: the CAD Python suite and anything on a board. The ESP32 timing of the
motor callback with the new planner, step timing with Wi-Fi traffic, flash write behavior
(including the new write at `arm`) and the physical effect of the gentler profiles remain
bench items; read `max_tick_cost_us`, `max_tick_gap_us` and `timing_faults` during
qualification. The 1.0.0 binary hash and source fingerprint below belong to the 1.0.0
snapshot and were not recomputed. GitHub Actions did not run for these commits.

### Independent review of 1.1.0 and fixes

A separate read-only review of the 1.1.0 change found no defects in the profile
mathematics or step emission and reported five behavioral findings. Each was reproduced
here and fixed with a regression test:

1. A synchronized (time-stretched) axis braked with its stretched ceilings; after a zero
   jog during `move(20, 0.2)` tilt kept moving for 3.6 s. It now brakes with the move's
   unstretched ceilings and stops in 0.06 s. Profile tests check that braking with higher
   ceilings is never longer and never needs more room.
2. `disarm` without an armed session erased the stored last pose, and a STOP at rest
   discarded a trustworthy one. Only releasing an armed session replaces it now; a STOP at
   rest keeps it.
3. The last pose stayed valid in flash during an armed session, so a reset could leave a
   stale hint. An accepted `arm` now erases it from flash first, with the coils off.
4. Preset names could contain `"` or `\` through a crafted settings blob, producing
   invalid JSON. Both characters are now rejected everywhere, including the clients.
5. `eta` and each axis `target` ignored a queued retarget. They now include it; the ETA
   matched the measured time within 8 % in the regression test.

The panel's diagonal jog and the start of a jog pressed during a status poll are covered
by its browser test, which passed three consecutive runs. After these changes all seven
native suites pass with Clang 18, ASan and UBSan, and `contracts/state-v1.json` is
unchanged.

## Independent review and corrections

Two bounded reviewers inspected motion and runtime contracts. Their actionable
findings were corrected:

1. Timer rounding at maximum speed accumulated overdue steps. Emitted steps
   now rebase the analytical profile clock, stretching time rather than issuing
   catch-up bursts. Regression and randomized jitter tests pass.
2. Extremely small jog fractions underflowed the planner. Nonzero fractions
   below 0.025 are rejected before planning.
3. Serial replies could overwrite a pending HTTP response. Each transport now
   owns a separate output buffer.
4. Blocking serial output could starve HTTP for seconds. Serial accepts one
   complete packet per pass and drains only currently available UART capacity.

The second review passes found no additional actionable issues within those
scopes. Review and native tests are evidence of examined behavior, not proof
that every possible device failure has been eliminated.

## Reproduce and identify this build

Run the commands in the [firmware guide](../README.md).
The public build is `firmware/.pio/build/public/firmware.bin`; it contains no
network credentials and requires a configured local build for Wi-Fi control.

Local application binary SHA-256:

```text
b3c4518cdcb9ab9f7a5f4a1709ae46f4b30dd54498f1db289f96457b75044023
```

Maintained source fingerprint, covering the 23 nonignored files under
`firmware/`, `hardware/cad/parameters.json` and the four new firmware test/contract tools:

```text
82e301eccfeef5212a65550e5d535590573933a5abd8e06ea2d7d4bbc64cacd6
```

The fingerprint hashes sorted repository-relative UTF-8 paths, a NUL byte,
each file's raw bytes, then another NUL byte. The tools are
`test_firmware.py`, `firmware_contract.py`, `check_firmware_variants.py` and
`test_firmware_ui.mjs`. Generated headers, `.pio/`, private credentials and
Python caches are excluded. The existing `AGENTS.md` was preserved byte-for-byte.

## Required bench qualification

Before fitting the camera and enabling full travel, verify the actual pinout
and phase order, one-degree direction, calibrated steps per axis, gear/belt
backlash and loaded repeatability. Measure supply sag, driver/motor temperature,
PLA temperature/creep and loss-of-power behavior with the intended holding duty.

Test the GPIO waveform and timing diagnostics during sustained Wi-Fi traffic,
serial traffic and reconnects. Check STOP, jog lease expiry, controller timeout,
optional physical stop opening/stuck states, reboot/brownout, and explicit
re-reference recovery. Exercise real cables throughout combined motion.
No encoders or home sensors are installed; automatic homing remains unimplemented.
