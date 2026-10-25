# Firmware verification

Scope: software checks for firmware 1.0.0 (20 October 2026) and 1.1.0 (21 October 2026).
No board flashed. No powered motion. No mechanical, electrical or thermal qualification.
Compiling proves none of those.

## Firmware 1.1.0

API v1 kept; only optional fields and operations added: jerk-limited S-curve profiles
(`profile.hpp`) with a per-axis `jerk` setting, stops planned from present speed and
acceleration, synchronized pan/tilt arrival, runtime `motion` scales and per-move `speed`,
opt-in retargeting, `eta`/`queued`/`accel_now`/`max_tick_cost_us` diagnostics, named
presets with `preset_save`/`preset_clear`, a persisted last-pose hint, settings blob
version 2 (reads version 1) and panel controls for all of it. Jog release takes about
0.5–0.7 s from full speed, longer than the 1.0.0 trapezoid stop.

| Check | Result |
|---|---|
| Native C++ suites | Seven executables pass with Clang 18, `-Wall -Wextra -Wpedantic -Werror`, ASan and UBSan (the CI invocation); also pass with GCC 13 |
| Profile properties | 4,000 random rest-to-rest profiles across every regime: speed, acceleration and jerk ceilings, central-difference derivatives, monotonic position, closed-form durations, exact time stretching; 240,000 inverse lookups from arbitrary hints; 120,000 stops from random mid-move states end at rest within ceilings and never need more distance than the move had left |
| Motion stress | 300 random dual-axis moves, 188,767 emitted half-steps, 230–270 µs jitter, 64-bit clock crossing; per-tick acceleration and jerk bounds checked |
| Controller features | Synchronized arrival and straightness, runtime and per-move scales, retarget/relative/repeat/STOP/jog/disarm interactions, ETA; 1,440 randomized events (1,064 mid-move retargets and brakes) under timer jitter, every tick audited for speed, acceleration, jerk, continuity, limits, step spacing and faults |
| Test sensitivity | Mutants that halve the jerk bound, allow one search round, or brake with doubled acceleration fail the suites. Removing the 1 µs rebase margin does not: it is a safety margin the simulation does not exhaust |
| Protocol | New operations and option validation; 60,000 mutated commands executed (not only parsed) under sanitizers with invariants on scales, names, poses and limits; worst-case status JSON is well-formed at about 1.6 KB of the 4,096-byte buffer; truncation reported as failure |
| Persistence | Version 2 round trip; every single-byte corruption; 19 resealed (valid-CRC) version 2 and 3 version 1 corruptions rejected without touching the device; version 1 blobs from a copy of the 1.0.0 encoder migrate with presets and calibration, then re-encode and reload identically |
| ESP32 builds | Public build compiles with `-Werror`: RAM 60,268 bytes (18.4 %), flash 812,785 bytes (62.0 %); the Wi-Fi + GPIO32 STOP fixture compiles |
| Browser | Firmware panel test (3 consecutive runs): motion scales, retargeting, named presets, save present pose, clear, validation, last-pose hint, diagonal jog, jog pressed during a status poll. Solid remote passes its 6 integration tests against 1.1.0; 12 Node unit tests pass; regenerated `contracts/state-v1.json` accepted by the JS session and the integration fixture |

### Review fixes in 1.1.0

An independent read-only review found no defects in profile mathematics or step emission.
It reported five behavioral findings. Each was reproduced and fixed with a regression test:

1. A time-stretched axis braked with its stretched ceilings: after a zero jog during
   `move(20, 0.2)`, tilt kept moving for 3.6 s. It now brakes with the unstretched
   ceilings and stops in 0.06 s.
2. `disarm` without an armed session erased the stored last pose, and STOP at rest
   discarded a valid one. Now only releasing an armed session replaces it.
3. The last pose stayed valid in flash during an armed session, so a reset could leave a
   stale hint. An accepted `arm` now erases it first, with coils off.
4. A crafted settings blob could put `"` or `\` in a preset name, producing invalid JSON.
   Both characters are rejected everywhere, including the clients.
5. `eta` and axis `target` ignored a queued retarget. Both include it now; ETA matched
   measured time within 8 % in the regression test.

## Firmware 1.0.0

| Check | Result |
|---|---|
| CAD/firmware contract | Ratios, travel envelope, nominal step count and motion ceilings match `hardware/cad/parameters.json` |
| Native C++ suites | Five executables pass with Clang, `-Wall -Wextra -Wpedantic -Werror`, ASan and UBSan |
| Motion stress | 300 deterministic randomized dual-axis trajectories; 196,435 emitted half-steps |
| Timing invariants | 230–270 µs jitter and 251 µs ticks; step interval ≥1250 µs, acceleration/speed bounds, phase/reversal, limits, final positions, 64-bit clock crossing |
| State handling | Boot/release outputs, reference/arm, STOP latch, watchdog, jog expiry, stale epochs/sequences, fractional relative moves, timing-fault position invalidation |
| Protocol stress | 50,000 mutated/truncated JSON packets, 30,000 mutated HTTP requests; duplicate, malformed, oversized, partial and authentication cases |
| Persistence | 231-byte settings round trip, corruption at every byte, invalid booleans, changed mechanical fingerprint with recomputed CRC; failed loads leave state untouched |
| Public ESP32 build | 57,348 / 327,680 bytes static RAM (17.5 %); 798,629 / 1,310,720 bytes flash (60.9 %) |
| Configured compile fixture | Passes with fake Wi-Fi credentials and GPIO32 stop; temporary binary removed, no upload |
| Chromium remote | Connect, reference, arm, geared move, pointer jog/release, STOP during delayed response, preset save, no token storage, 390 px layout |

Review fixes in 1.0.0:

1. Timer rounding at maximum speed accumulated overdue steps. Emitted steps now rebase the
   profile clock: time stretches, no catch-up bursts.
2. Tiny jog fractions underflowed the planner. Nonzero fractions below 0.025 are rejected.
3. Serial replies could overwrite a pending HTTP response. Each transport owns its buffer.
4. Blocking serial output could starve HTTP for seconds. Serial takes one packet per pass
   and drains only available UART capacity.

1.0.0 snapshot identifiers (not recomputed for 1.1.0):

- Application binary SHA-256: `b3c4518cdcb9ab9f7a5f4a1709ae46f4b30dd54498f1db289f96457b75044023`
- Source fingerprint: `82e301eccfeef5212a65550e5d535590573933a5abd8e06ea2d7d4bbc64cacd6`.
  It hashes sorted repository-relative UTF-8 paths, a NUL byte, each file's raw bytes,
  then another NUL byte, over the firmware sources, `hardware/cad/parameters.json` and
  the firmware test/contract tools of that snapshot. Generated headers, `.pio/`,
  credentials and caches excluded.

## Limits of this evidence

- Browser tests run the real portable C++ controller in a host fixture. They do not run
  the ESP32 adapter, radio or GPIO timing.
- Mutation testing is bounded. It is not exhaustive parser or security coverage.
- The host fixture uses exact IEEE doubles. The ESP32 emulates doubles in software, so
  planner and per-step search cost on the board is unknown.
- Not established on hardware: motor-callback timing with the S-curve planner, step
  timing under Wi-Fi traffic, flash write behavior (including the write at `arm`), the
  physical effect of the gentler profiles.

## Reproduce

Run the commands in the [firmware guide](../README.md). The public binary is
`firmware/.pio/build/public/firmware.bin`. It holds no network credentials; Wi-Fi control
needs a configured local build.

## Bench qualification still required

Before fitting the camera and enabling full travel:

- Verify actual pinout and phase order, one-degree direction, calibrated steps per axis,
  gear/belt backlash and loaded repeatability.
- Measure supply sag, driver/motor temperature, PLA temperature/creep and loss-of-power
  behavior at the intended holding duty.
- Test GPIO waveform and `max_tick_cost_us`, `max_tick_gap_us`, `timing_faults` under
  sustained Wi-Fi traffic, serial traffic and reconnects.
- Check STOP, jog lease expiry, controller timeout, optional physical stop open/stuck
  states, reboot/brownout and explicit re-reference recovery.
- Run real cables through combined motion.

No encoders or home sensors are installed; automatic homing is not implemented.
