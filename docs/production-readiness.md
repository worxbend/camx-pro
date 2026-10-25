# Production readiness — 21 October 2026

Status: **not production-qualified. Powered commissioning is still required.**
All parts are printed and fit. Motors are not yet tested. Fit evidence is not
motor, load or thermal evidence.

## Software review

- Seven native C++ suites pass with ASan/UBSan: 300 dual-axis moves, 188,767
  emitted half-steps, 120,000 stop profiles and 1,440 randomized controller
  events. Clang's static analyzer reports no findings across the seven suites.
- Public ESP32 firmware and the isolated fake-credential/GPIO32 STOP variant
  compile. Public build after the panel fixes below: static RAM 60,268 bytes
  (18.4%), flash 813,281 bytes (62.0%). No hardware was flashed.
- New firmware-panel browser tests found two session defects:
  - an observer could issue motion while another session owned the device;
  - blur during an outstanding ARM did not request STOP.

  Both are fixed and the expanded regression passes. The panel also cancels
  queued jog intent after errors and drops ownership on a foreign
  epoch/sequence. These are browser protections, not firmware access roles.
- JS dependency audit: zero advisories. This covers npm dependencies, not the
  ESP32 SDK. Actionlint passes.
- Web and terminal results: [controller verification](controllers-verification.md).

## Open release issues

1. **Unsupported SDK.** The pinned Arduino package contains ESP-IDF 4.4.7.
   Espressif ended 4.4 support, including bug and security fixes, in July 2024.
   A supported production release needs a maintained SDK/toolchain migration and
   a regression pass. See
   [Espressif advisory AR2024-008](https://documentation.espressif.com/AR2024-008%20End-of-Life%20Advisory%20for%20ESP-IDF%20v4.4%20Release%20Branch%20EN.html).
2. **Device timing is unmeasured.** Host tests do not show whether the
   floating-point planner fits its 250 µs ESP32 callback under Wi-Fi load.
   [Espressif's timer documentation](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/system/esp_timer.html)
   describes callback delays from higher-priority work, including flash operations.
3. **Diagonal paths are approximate.** Both motors run concurrently and planned
   durations match. Independent profile shapes and step timing do not enforce a
   straight path in pan/tilt space. An ideal 250 µs host probe of a 20° pan / 3°
   tilt move found a maximum normalized-progress difference of 0.1182 (11.82
   percentage points). A straight path needs more planner work, if required.
4. **Powered operation is unqualified.** Not yet checked on the assembly:
   direction, calibration, missed steps, load capacity, cable movement, supply
   sag, temperature, duty cycle and fault recovery. The optional physical STOP
   input is disabled in the default board configuration.

## Commissioning evidence to collect

Follow the [firmware commissioning guide](../firmware/README.md) with the
mechanism supported and the reduced defaults: pan ±20°, tilt ±15°, 4°/s, 8°/s²,
80°/s³. Keep `commissioned` false until the applicable checks are complete.

| Check | Acceptance evidence | Current status |
| --- | --- | --- |
| Printed assembly | Printed parts fit | Confirmed |
| Power and wiring | Actual board/driver pinout, phase order, selected ESP32 power path, measured supply under both motors | Pending |
| First motion | Manual reference, arm, 1° pan each way, 1° tilt each way; actual directions agree with commands | Pending |
| Diagonal motion | Small combined moves and diagonal jog/release; both axes move, settle and return repeatably without missed steps or cable snags | Pending |
| Stops and recovery | STOP, jog expiry, lost Wi-Fi, closed browser, reboot and any installed switch; no automatic restart, explicit re-reference as required | Pending |
| Timing | Capture `max_tick_cost_us`, `max_tick_gap_us`, `timing_faults` and GPIO waveforms under sustained traffic; callback has margin below 250 µs and no timing faults | Pending |
| Loaded endurance | Intended camera/cables, recorded cycle count and duration, repeatability, supply sag and component temperatures within verified ratings | Pending |
| Release identity | Record exact source revision, configured binary hash and calibration; keep credentials/configured binaries private | Pending |

The website's animated model is a geometry preview, not motor-test evidence.
