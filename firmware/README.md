# CAMX Pro ESP32 firmware

Firmware for **ESP32-WROOM-32 / ESP32 DevKit**, two **5 V 28BYJ-48** motors and
two **ULN2003** boards. The webcam remains a separate USB video device.

The pan motor drives the fixed-ring **20T/60T planetary reduction (4:1)**.
The tilt motor drives the **20T/40T belt reduction (2:1)**. Nominal 4096
half-steps per geared motor output revolution is provisional, giving
16384 pan and 8192 tilt half-steps per axis revolution. Do not multiply the
motor's internal gearbox ratio again.

## Build and check

From the repository root, use Python 3.10+ and PlatformIO 6.2.0:

```sh
python -m pip install platformio==6.2.0
python3 tools/contracts/firmware.py --check
python firmware/tools/test_native.py
pio run -d firmware -e public
python firmware/tools/check_variants.py
```

Native checks require Clang with AddressSanitizer/UndefinedBehaviorSanitizer;
`CXX=g++ python firmware/tools/test_native.py` selects GCC. PlatformIO pins
Espressif32 6.12.0, Arduino-ESP32 2.0.17 and its package revision; the packaged
SDK identifies itself as ESP-IDF 4.4.7. There are no third-party runtime libraries.
The variant check uses temporary fake credentials and enables GPIO32 STOP in
an isolated copy; it never reads private credentials, uploads or keeps its binary.

Browser checks use the root npm workspace's locked development dependency:

```sh
npm ci
npx playwright install chromium
npm run test:firmware-ui
```

This runs the actual portable C++ controller behind a local browser fixture.
It exercises software behavior without GPIO. It does not emulate Wi-Fi or
ESP32 scheduling. CI builds the public firmware and runs both test suites.

## Wiring

| ULN2003 input | Pan GPIO | Tilt GPIO |
|---|---:|---:|
| IN1 | 16 | 21 |
| IN2 | 17 | 22 |
| IN3 | 18 | 23 |
| IN4 | 19 | 25 |

Connect to the physical **IN1–IN4 labels in this order**. This is four-phase
half-step control, not servo PWM, STEP/DIR or current-controlled microstepping.
The eight output masks are `1, 3, 2, 6, 4, 12, 8, 9`. Use the axis inversion
settings if positive movement is reversed; check the motor/module wiring if
the shaft vibrates without turning.

These pins are intended for WROOM: Espressif reserves GPIO16/17 for other uses
on WROVER variants. See the
[DevKitC pin guide](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html).
Clone-board labels and electrical behavior still need verification.

Feed regulated 5 V directly to each driver and join grounds. Never feed
motor current through the ESP32. Keep the camera USB path separate. Select one
ESP32 power path while programming; see [power wiring](../hardware/docs/wiring.md).
Verify that driver inputs remain inactive while the ESP32 resets; fit pull-downs
if the actual modules leave those inputs floating.

An optional normally closed stop contact can use **GPIO32 to GND**. Set
`board::stopPin = 32` in `include/board.hpp` only after wiring it. Open/high
latches STOP; closing it does not resume motion. It is disabled by default
because no switch was confirmed. This GPIO input and the HTTP STOP button are
software stops; neither disconnects motor power independently of firmware.

## Configure and flash

1. Copy `firmware/include/credentials.example.h` to ignored
   `firmware/include/credentials.h`.
2. Set the 2.4 GHz SSID/password and a random 16–96 character printable ASCII
   API token. For example, generate a token with
   `python -c 'import secrets; print(secrets.token_hex(24))'`.
3. Identify the programming port with `pio device list`. Build locally:
   `pio run -d firmware -e esp32dev`.
4. With the mechanism supported and motor power disconnected for the initial
   flash, upload using your actual port:
   `pio run -d firmware -e esp32dev -t upload --upload-port /dev/ttyUSB0`.
5. Open `pio device monitor -b 115200 -p /dev/ttyUSB0`. The firmware reports
   its IP when Wi-Fi connects. Open that HTTP address and enter the API token.

The `public` build always ignores credentials and has network control disabled.
It still accepts physical serial commands. No default access point or password
is created. Configured binaries contain your credentials and must stay private.
HTTP is for a trusted local network; the bearer token is not encrypted on the
wire. Use a secured host bridge/VPN for remote access, not a public port forward.

No upload, powered motor test or electrical verification was performed during
local development.

## First motion and calibration

1. Confirm the unpowered motor, gearbox, bearings, belt and cable paths move
   freely. Support the camera when coils are released.
2. With motors released, physically align pan center and level tilt to witness
   marks. Use **Confirm aligned position**, then **Arm motors**. Energizing the
   initial phase can cause a small settling movement: keep clear and verify it.
3. Start with one-degree moves on one axis at a time. Verify direction, then
   configure inversion while released if necessary and repeat the reference.
4. Defaults limit pan to **±20°** and tilt to **±15°**, at **4°/s**, **8°/s²**.
   Inspect clearance and cable behavior throughout this reduced travel first.
5. Measure repeatable travel with an external angle reference. Adjust each
   `*_steps` independently: `new_steps = old_steps × commanded_angle / measured_angle`.
   Approach measurements from the same direction to separate backlash from
   scale error. Repeat referencing after configuration changes.
6. Qualify load, missed steps, holding temperature, PLA creep and USB routing.
   Only then set `commissioned: true` and explicitly widen limits, up to the CAD
   envelope **pan −160…160°, tilt −30…90°**. Setting the flag alone does not
   widen travel. Leave margin before physical stops and cable tension.

Motor speed limits apply at the **axis**, after both reductions. The hard
scheduler ceiling is 800 half-steps/s; that is a software ceiling, not a claim
that the loaded motors can achieve it. PLA thermal limits are not measured by
this firmware. Coils remain energized while armed, including after STOP or
connection loss. Release only with the camera supported; release invalidates
position. There is no automatic hold-current reduction on ULN2003.

## Behavior and architecture

- `include/camx/`: portable C++17 motion, protocol, bounded HTTP parser, settings
  codec and status serialization; `src/main.cpp`: ESP32 GPIO/network/NVS adapter.
- `web/index.html`: served from firmware; no filesystem upload or internet/CDN
  dependency. `tests/`: host tests and browser fixture. `.clang-format`: C++ style.
- Rest-to-rest trapezoidal profiles accelerate and decelerate each axis
  independently. Arrival times need not match. New position moves and direction
  changes return `busy` during motion; release a jog and wait before reversing.
  Acceleration is bounded; jerk is not bounded as it was in camx's Ruckig planner.
- A 250 µs `ESP_TIMER_TASK` callback advances the motor state under a short
  mutex. Parsing, networking, NVS and serialization happen outside that callback.
  It emits at most one half-step per axis per callback, keeps step intervals
  at least 1250 µs and stretches the profile for timer quantization instead of
  replaying delayed steps. A >10 ms moving callback gap or more than one overdue
  step latches a timing fault and invalidates position.
- [Espressif documents task/flash-related timer delays](https://docs.espressif.com/projects/esp-idf/en/v4.4.8/esp32/api-reference/system/esp_timer.html).
  Scheduling is not a hard real-time guarantee. Measure waveforms with Wi-Fi
  traffic and check `max_tick_gap_us`/`timing_faults` during bench qualification.
- Jog commands need renewal within **500 ms**; expiry decelerates to rest.
  Active controllers send heartbeats at least every second. **5 s** without an
  accepted command latches STOP. Wi-Fi link loss also stops; reconnection never
  resumes. Browser blur/hidden/page-close requests STOP, backed by the watchdog.
- STOP holds the last phase. If motion was interrupted, its position is no
  longer trusted. Recovery is **support → release → align → reference → arm**.
  Boot and brownout never restore reference or arm from flash.
- Eight numeric presets and axis calibration persist in a versioned, CRC32
  checked NVS blob. Writes require released motors. A changed mechanical
  fingerprint or corrupt blob falls back to reduced defaults. Storage failures
  are reported; RAM settings may remain active until reboot.

There are no installed home sensors or encoders. `reference` is an operator
acknowledgment; `center` moves to zero. Automatic sensor search is deliberately
unimplemented. Adding it requires selected sensors, wiring, approach/back-off,
debounce, travel/time limits, stuck-sensor detection and hardware tests.

See [API and migration](docs/api.md) and
[local validation](docs/verification.md). Existing camx servo clients
need an adapter for this versioned command protocol; OBS integration is through
that host-side API adapter, not a video or OBS plugin inside the ESP32.
