# Camera remotes

Both remotes target [CAMX Pro API v1](../firmware/docs/api.md), with the 4:1
external pan planetary and 2:1 tilt belt. Firmware converts degrees to geared
half-steps; clients never multiply by either ratio. Remotes control motion only.
Webcam USB video stays separate. Both work with firmware 1.0.0 and 1.1.0: they
read `api_minor` and offer 1.1.0 features only when the device reports them.

## Web application

Requires Node 24. From the repository root:

```sh
npm ci
npm run build:remote
CAMX_PRO_DEVICE_URL=http://DEVICE_IP npm run bridge
# Open http://127.0.0.1:4175/control/
```

Replace `DEVICE_IP` with the ESP32's LAN address. `CAMX_PRO_PORT` changes the local port.

Bridge boundaries:

- binds to loopback only; never expose it to the internet;
- permits one configured private/LAN origin and validates Host/Origin;
- limits request bodies and forwards the Bearer token;
- never follows redirects or retries commands.

The token is typed into the browser, cleared from the input on connect, kept in
memory and never written to browser storage. Disconnect or close the tab to discard it.

Configuration names: `CAMX_PRO_DEVICE_URL`, `CAMX_PRO_PORT`, `CAMX_PRO_API_TOKEN`.
The old `CAMX_DEVICE_URL`, `PORT` and `CAMX_API_TOKEN` names are ignored.

The [hosted remote](https://worxbend.github.io/camx-pro/control/?demo=1) is an
**offline demo**: HTTPS GitHub Pages cannot reach the ESP32's local HTTP API.
`npm run dev:remote` also starts in demo mode. Use a build plus the bridge for a
real device. Solid **2.0.0-rc.16** and its matching web/compiler packages are
pinned because v2 is still a release candidate.

1. Connect. Inspect the returned device limits and state.
2. Support the camera with coils released. Align both axes physically, enter
   their actual angles, acknowledge alignment, then confirm reference. After a
   clean release, firmware 1.1.0 shows where the mechanism last rested.
   **Use as reference angles** copies it into the fields. It is a hint: align first.
3. Arm explicitly. Drag the joystick or hold a point on its pad: right/left pans,
   up/down tilts, diagonals drive both axes. Distance from center sets requested
   speed, up to the selected 25%, 50% or 100% cap. The center dead zone stops
   small movements from starting a jog. Release to brake and recenter. With the
   joystick focused, hold arrow keys (pairs for diagonals); release to brake.
   **Esc** latches STOP. **Precision controls** shows direction buttons, exact
   targets and bounded single/diagonal steps.
4. STOP latches and keeps holding torque. Support the mechanism before releasing
   coils. Release invalidates the reference.

Firmware needs a complete brake before a jog changes direction or speed. The
joystick handles this: it keeps only the latest still-held vector and sends it
after motion settles. Release, lost pointer capture, a cancelled touch, lost
focus or STOP cancel pending joystick intent. The neutral zone brakes. The
controller never arms automatically. Percentages are requested speed fractions;
angle readouts are open-loop estimates. The joystick uses existing API v1
commands and works with both firmware versions. **Motion settings** holds feel
and stored-profile configuration.

On firmware 1.1.0 moves are jerk-limited and pan and tilt arrive together, so a
target or diagonal step moves both axes at once. The path can curve when the
axes have different profile shapes. The remote also offers:

- **Move speed %** for the next move, step or recall. **Retarget while moving**:
  a new target brakes the current move smoothly, then goes to the newest one.
- **Motion feel**: speed, acceleration and smoothness (jerk) percentages that
  lower configured values at runtime. Allowed while armed; not stored; no new reference.
- **Presets**: optional name (up to 16 printable ASCII characters, no `"` or `\`).
  **Save** stores the target fields (released only). **Here** stores the present
  pose (also while armed; flash written at release). **×** clears. The status
  strip shows *unsaved until release* while a change waits for flash.
- **Motion profile**: stored speed, acceleration and jerk. Jerk above 80 °/s³
  needs commissioned settings. Applies while released and needs a fresh reference.

With firmware 1.0.0 these controls are hidden and the remote sends only commands
that firmware knows. Diagonals, jog speed and steps still work. Advanced travel
limits, motor-step calibration and commissioning stay in the device's built-in
panel/API. The remote always shows actual device limits.

## Glyphora terminal application

Requires JDK 25. The checked-in Mill launcher downloads its pinned version.
Dependencies come from Maven Central: Scala 3.9.0, Glyphora 0.20.0, uJSON 4.4.3.
No sibling checkout or GitHub Packages token needed.

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
supply `CAMX_PRO_API_TOKEN` from your environment or secret manager. Keep literal
secrets out of shell history. `--demo` never contacts hardware.

Operation:

- Tab/mouse selects controls.
- Enter actual pan/tilt angles, choose **Reference...**, align physically, press
  **Ctrl+r** to acknowledge. **Use last pose** fills the angles from firmware
  1.1.0's last-pose hint. Arm explicitly.
- **Alt+arrows**: one bounded step (default 1°, configurable up to 5°).
  **Alt+y / Alt+u / Alt+b / Alt+n**: step up-left / up-right / down-left /
  down-right. The *Diagonal* buttons do the same.
- A step pressed while only a background status poll is in flight runs right
  after it. Otherwise held-key auto-repeat is ignored while a request or movement
  is pending. Terminal key-release events vary, so the TUI uses steps, not held jog.
- **Esc** requests STOP. **q** quits outside text editing.
- Needs a terminal of at least 76×27 cells. Smaller windows keep STOP/quit guidance.

Presets: slots 1–8 in the UI map to API slots 0–7. **Save target** stores the
entered angles while released. **Save here** stores the present pose (also while
armed). **Clear** empties the slot. **Recall** moves there. The optional name goes
with either save. The *MOTION* panel holds runtime **feel** percentages, **Move
speed %**, the **Retarget while moving** checkbox and the stored
speed/acceleration/jerk profile. With firmware 1.0.0 the 1.1.0 rows become a
notice and their commands are never sent. JSON mode includes full diagnostics.

## Session and failure behavior

Use one active controller.

- Both clients serialize normal commands, consume the returned epoch/sequence
  even on rejection, and keep an explicit ownership flag.
- Only the session that armed the camera sends heartbeats (every second).
  Observers never keep another controller alive.
- Reconnect never references or arms automatically. No mutation is retried after a timeout.
- Web remote: a jog press, jog release or command that meets a background poll,
  heartbeat or lease renewal waits for that request, then is sent right after it
  (a release then brakes smoothly). STOP cancels the wait. A release that cannot
  be ordered safely sends STOP.

STOP uses a new local generation, so late replies cannot restore an old armed
state. Web blur, page hide, disconnect and terminal exit request best-effort STOP
for an owned or possibly armed session. A failed network cannot guarantee STOP
delivery. The firmware's five-second heartbeat watchdog and 500 ms jog lease are
the fallback. On uncertain state, inspect and re-reference the mechanism
deliberately. Software STOP is not a hardware emergency-stop circuit.

## Verification and references

[Verification record and CI evidence](controllers-verification.md).

- `npm test`: session races, protocol validation (firmware 1.1.0 fields and their
  absence on 1.0.0), the demo's 1.1.0 behavior and bridge boundaries.
- `npm run test:browser`: the real Solid application against the portable C++
  firmware simulator, plus Pages/viewer checks.
- Glyphora Pilot tests render and operate the real TUI. HTTP tests use loopback mock devices.

Demo transports are UI demonstrations, not evidence of mechanical or firmware
timing accuracy. No physical device was flashed or moved by these tests.

Both remotes implement this repository's [firmware API](../firmware/docs/api.md).
The local bridge lives in `packages/bridge/`; it needs only the built web remote
and an explicitly configured CAMX Pro device. The TUI uses the published
[Glyphora library](https://github.com/worxbend/glyphora/tree/v0.20.0).
