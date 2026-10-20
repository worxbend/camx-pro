# Firmware local verification — 20 October 2026

CAMX Pro 1.0.0 is implemented for ESP32-WROOM-32, two ULN2003-driven
28BYJ-48 motors, the 4:1 planetary pan actuator and 2:1 tilt belt drive.
This record covers software checks. No board was flashed, powered movement
performed or mechanical/thermal qualification inferred from compilation.

## Completed checks

| Check | Result |
|---|---|
| CAD/firmware contract | Generated ratios, travel envelope, nominal step count and motion ceilings match `cad/parameters.json` |
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

Run the commands in the [firmware guide](../firmware/README.md).
The public build is `firmware/.pio/build/public/firmware.bin`; it contains no
network credentials and requires a configured local build for Wi-Fi control.

Local application binary SHA-256:

```text
b3c4518cdcb9ab9f7a5f4a1709ae46f4b30dd54498f1db289f96457b75044023
```

Maintained source fingerprint, covering the 23 nonignored files under
`firmware/`, `cad/parameters.json` and the four new firmware test/contract tools:

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
