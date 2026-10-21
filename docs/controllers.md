# Camera remotes

Both remotes target [CAMX Pro API v1](../firmware/docs/api.md), including the 4:1 external
pan planetary and 2:1 tilt belt. The firmware converts degrees to geared
half-steps; clients do not multiply by either ratio. They control motion only.
The webcam's USB video remains separate. Both work with firmware 1.0.0 and 1.1.0:
they read `api_minor` and offer the 1.1.0 features only when the device reports them.

## Web application

Requires Node 24. From the repository root:

```sh
npm ci
npm run build:remote
CAMX_PRO_DEVICE_URL=http://DEVICE_IP npm run bridge
# Open http://127.0.0.1:4175/control/
```

Replace `DEVICE_IP` with the ESP32's actual LAN address. The bridge binds only
to loopback, permits one configured private/LAN origin, validates Host/Origin,
limits request bodies, forwards the Bearer token, and never follows redirects
or retries commands. Set `CAMX_PRO_PORT` to change its local port. Do not expose this
server to the internet. The token is entered into the browser, cleared from the
input on connection, retained in memory and never written to browser storage.
Disconnect or close the tab to discard it.

Use `CAMX_PRO_DEVICE_URL`, `CAMX_PRO_PORT` and `CAMX_PRO_API_TOKEN` for this
project. The earlier `CAMX_DEVICE_URL`, `PORT` and `CAMX_API_TOKEN` names are
ignored; update launch scripts and environment configuration accordingly.

The [hosted remote](https://worxbend.github.io/camx-pro/control/?demo=1) is an
**offline demo**. HTTPS GitHub Pages cannot directly operate the ESP32's local
HTTP API. `npm run dev:remote` also starts in demo mode; build and use the bridge
for a real device. Solid **2.0.0-rc.16** and its matching web/compiler packages
are pinned because v2 is still a release candidate.

1. Connect and inspect the returned device limits and state.
2. Support the camera with coils released. Physically align both axes, enter
   their actual angles, acknowledge alignment, then confirm reference. After a
   clean release, firmware 1.1.0 shows where the mechanism last rested;
   **Use as reference angles** copies it into the fields. It is a hint: align first.
3. Arm explicitly. Drag the joystick or hold a point on its pad: right/left pans,
   up/down tilts, and diagonals drive both axes. Distance from center sets the
   requested speed up to the selected 25%, 50% or 100% cap. The center dead zone
   prevents small movements from starting a jog. Release to brake and recenter.
   With the joystick focused, hold arrow keys (including pairs for diagonals);
   release them to brake. **Esc** latches STOP. **Precision controls** exposes the
   direction buttons, exact targets and bounded single/diagonal steps.
4. STOP latches and retains holding torque. Support the mechanism before
   releasing coils; release invalidates the reference.

The current firmware requires a complete brake before changing a jog's direction
or speed. The joystick handles this automatically: it retains only the latest
still-held vector and sends it after motion settles. Releasing, losing pointer
capture, a cancelled touch, losing focus or STOP cancels pending joystick intent.
Returning to the neutral zone brakes; the controller never arms automatically.
The displayed percentages are requested speed fractions, while angle readouts
remain open-loop estimates. Joystick input uses the existing API v1 commands and
works with both supported firmware versions. Expand **Motion settings** for feel
and stored profile configuration.

On firmware 1.1.0 moves are jerk-limited and pan and tilt arrive together, so a
target or diagonal step moves both axes concurrently. The path can curve when
the axes have different profile shapes. The remote then also offers:

- **Move speed %** for the next move, step or recall, and **Retarget while moving**: a new
  target brakes the move in progress smoothly and then goes to the newest one.
- **Motion feel**: speed, acceleration and smoothness (jerk) percentages that lower the
  configured values at runtime. Allowed while armed; not stored; no new reference.
- **Presets**: an optional name (up to 16 printable ASCII characters, without `"` or `\`),
  **Save** (the target fields, released only), **Here** (the present pose, also while
  armed; flash is written at release) and **×** (clear). The status strip shows
  *unsaved until release* while a change waits for flash.
- **Motion profile**: stored speed, acceleration and jerk (jerk above 80 °/s³ needs
  commissioned settings). Applies while released and requires a fresh reference.

With firmware 1.0.0 these controls are hidden and the remote sends only commands that
firmware understands; diagonals, jog speed and steps still work. Advanced travel limits,
motor-step calibration and commissioning remain in the device's built-in panel/API. The
remote always displays actual device limits.

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
provide `CAMX_PRO_API_TOKEN` through your environment/secret manager; avoid putting
literal secrets into shell history. `--demo` never contacts hardware.

Use Tab/mouse to select controls. Enter actual pan/tilt angles, choose
**Reference...**, physically align, and press **Ctrl+r** to acknowledge. **Use last
pose** fills the angle fields from firmware 1.1.0's last-pose hint. Arm explicitly.
**Alt+arrows** issue one bounded step (default 1°, configurable up to 5°);
**Alt+y / Alt+u / Alt+b / Alt+n** step up-left / up-right / down-left / down-right,
and the *Diagonal* buttons do the same. A step requested while only a background
status poll is in flight runs right after it; otherwise held-key auto-repeat is ignored
while a request or movement is pending. Terminal key-release events vary, so the TUI
deliberately uses steps, not held jog. **Esc** requests STOP; **q** quits outside text
editing. A supported terminal of at least 76×27 cells is required; smaller windows
retain STOP/quit guidance.

Preset slots are numbered 1–8 in the interface and translated to API slots 0–7.
**Save target** stores the entered angles while released; **Save here** stores the
present pose (also while armed); **Clear** empties the slot; **Recall** moves there.
The optional name is sent with either save. The *MOTION* panel holds runtime **feel**
percentages, **Move speed %**, the **Retarget while moving** checkbox and the stored
speed/acceleration/jerk profile. With firmware 1.0.0 the 1.1.0 rows are replaced by a
notice and their commands are never sent. The JSON mode includes full diagnostics.

## Session and failure behavior

Use one active controller. Both clients serialize normal commands, consume the
returned epoch/sequence even on rejection, and keep an explicit ownership flag.
Only a session that armed the camera sends heartbeats (every second). Observers
never keep another controller alive. Reconnection never automatically references
or arms. No mutation is automatically retried after a timeout. In the web remote a jog
press, a jog release or a command that meets a background poll, heartbeat or lease
renewal waits for that request and is sent right after it (a release then brakes
smoothly); STOP cancels the wait, and a release that cannot be ordered safely sends STOP.

STOP uses a new local generation so late replies cannot restore an old armed
state. Web blur, page hide, disconnect, and terminal exit request best-effort
STOP for an owned or possibly armed session. A failed network cannot guarantee
STOP delivery; the firmware's five-second heartbeat watchdog and 500 ms jog
lease remain the fallback. On uncertain state, inspect and re-reference the
mechanism deliberately. Software STOP is not a hardware emergency-stop circuit.

## Verification and references

See the [verification record and CI evidence](controllers-verification.md).

`npm test` exercises session races, protocol validation (including the firmware 1.1.0
fields and their absence on 1.0.0), the demo's 1.1.0 behavior, and bridge boundaries.
`npm run test:browser` runs the actual Solid application against the portable
C++ firmware simulator, plus Pages/viewer checks. Glyphora Pilot tests render and
operate the real TUI; HTTP tests use loopback mock devices. The demo transports
are UI demonstrations, not evidence of mechanical or firmware timing accuracy.
No physical device was flashed or moved by these tests.

Both remotes implement this repository's [firmware API](../firmware/docs/api.md).
The local bridge is maintained in `packages/bridge/`; it requires only this
project's built web remote and an explicitly configured CAMX Pro device.
The terminal UI uses the published [Glyphora library](https://github.com/worxbend/glyphora/tree/v0.20.0).
