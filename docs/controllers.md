# Camera remotes

Both remotes target [CAMX Pro API v1](firmware-api.md), including the 4:1 external
pan planetary and 2:1 tilt belt. The firmware converts degrees to geared
half-steps; clients do not multiply by either ratio. They control motion only.
The webcam's USB video remains separate.

## Web application

Requires Node 24. From the repository root:

```sh
npm ci
npm run build:remote
CAMX_DEVICE_URL=http://DEVICE_IP npm run bridge
# Open http://127.0.0.1:4175/control/
```

Replace `DEVICE_IP` with the ESP32's actual LAN address. The bridge binds only
to loopback, permits one configured private/LAN origin, validates Host/Origin,
limits request bodies, forwards the Bearer token, and never follows redirects
or retries commands. Set `PORT` to change its local port. Do not expose this
server to the internet. The token is entered into the browser, cleared from the
input on connection, retained in memory and never written to browser storage.
Disconnect or close the tab to discard it.

The [hosted remote](https://worxbend.github.io/camx-pro/control/?demo=1) is an
**offline demo**. HTTPS GitHub Pages cannot directly operate the ESP32's local
HTTP API. `npm run dev:remote` also starts in demo mode; build and use the bridge
for a real device. Solid **2.0.0-rc.16** and its matching web/compiler packages
are pinned because v2 is still a release candidate.

1. Connect and inspect the returned device limits and state.
2. Support the camera with coils released. Physically align both axes, enter
   their actual angles, acknowledge alignment, then confirm reference.
3. Arm explicitly. Hold a direction for half-speed jog, or send a bounded
   step, target angle or preset. Release a held direction to decelerate.
4. STOP latches and retains holding torque. Support the mechanism before
   releasing coils; release invalidates the reference.

Eight presets save the **explicit target fields** while released. Speed and
acceleration apply to both axes while released and require a fresh reference.
Advanced travel limits, motor-step calibration and commissioning remain in
the device's built-in panel/API. The remote always displays actual device limits.

## Glyphora terminal application

Requires JDK 25; the checked-in Mill launcher downloads its pinned version.
Dependencies come from Maven Central: Scala 3.9.0, Glyphora 0.20.0, uJSON 4.4.3.
No sibling checkout or GitHub Packages token is required.

```sh
cd apps/tui
./mill app.run --demo
./mill app.run --url http://DEVICE_IP
./mill app.run --url http://DEVICE_IP --json  # read state once; no movement
./mill app.test
./mill app.assembly
# Runnable jar: out/app/assembly.dest/out.jar
```

Live mode prompts for the API token before opening the terminal. For automation,
provide `CAMX_API_TOKEN` through your environment/secret manager; avoid putting
literal secrets into shell history. `--demo` never contacts hardware.

Use Tab/mouse to select controls. Enter actual pan/tilt angles, choose
**Reference...**, physically align, and press **Ctrl+r** to acknowledge. Arm
explicitly. **Alt+arrows** issue one bounded step (default 1°, configurable up to
5°); held-key auto-repeat is ignored while a request/movement is pending.
Terminal key-release events vary, so the TUI deliberately uses steps, not held
jog. **Esc** requests STOP; **q** quits outside text editing. A supported terminal
of at least 76×27 cells is required; smaller windows retain STOP/quit guidance.

Preset slots are numbered 1–8 in the interface and translated to API slots 0–7.
Save the entered angles while released; recall while armed. The profile section
sets speed and acceleration for both axes. The JSON mode includes full diagnostics.

## Session and failure behavior

Use one active controller. Both clients serialize normal commands, consume the
returned epoch/sequence even on rejection, and keep an explicit ownership flag.
Only a session that armed the camera sends heartbeats (every second). Observers
never keep another controller alive. Reconnection never automatically references
or arms. No mutation is automatically retried after a timeout.

STOP uses a new local generation so late replies cannot restore an old armed
state. Web blur, page hide, disconnect, and terminal exit request best-effort
STOP for an owned or possibly armed session. A failed network cannot guarantee
STOP delivery; the firmware's five-second heartbeat watchdog and 500 ms jog
lease remain the fallback. On uncertain state, inspect and re-reference the
mechanism deliberately. Software STOP is not a hardware emergency-stop circuit.

## Verification and references

`npm test` exercises session races, protocol validation, and bridge boundaries.
`npm run test:browser` runs the actual Solid application against the portable
C++ firmware simulator, plus Pages/viewer checks. Glyphora Pilot tests render and
operate the real TUI; HTTP tests use loopback mock devices. The demo transports
are UI demonstrations, not evidence of mechanical or firmware timing accuracy.
No physical device was flashed or moved by these tests.

The implementation follows the published [Glyphora documentation](https://github.com/worxbend/glyphora/tree/v0.20.0),
the [AirGradient Scala consumer](https://github.com/worxbend/airgradient-tui-scala),
and the localhost bridge architecture in [camx](https://github.com/worxbend/camx).
