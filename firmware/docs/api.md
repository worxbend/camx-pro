# CAMX Pro firmware API v1

The ESP32 controls movement only. The Anker C200 sends video directly to the
host over USB. This versioned API is defined and maintained by CAMX Pro.

**Firmware 1.1.0 (`"api_minor":1`)** adds only optional fields and operations to
API v1: jerk-limited motion, synchronized pan/tilt arrival, runtime speed
scales, retargeting, named presets, saving the present pose, and a last-pose
hint. Every request and response of 1.0.0 still means what it did; a client
that ignores unknown response fields needs no change. `api_minor` is absent in
1.0.0 firmware, so clients can feature-detect with `(state.api_minor ?? 0) >= 1`.

## HTTP and serial

`GET /` serves the control panel. Both `GET /api/state` and
`POST /api/command` require `Authorization: Bearer <API_TOKEN>`.
POST uses `Content-Type: application/json`, a numeric `Content-Length`, and
one flat JSON object. There is no CORS access or token query parameter.

The same command object can be sent as one LF-terminated line over physical
USB serial at 115200 baud. Serial does not require the network token. Startup
diagnostic lines are plain text; command responses are JSON lines.

Requests are bounded to 768 body bytes, 24 fields and 1536 HTTP header bytes.
Duplicate fields, unknown command fields, escaped strings, nested JSON,
non-finite numbers, booleans in number fields, malformed framing and chunked
transfer are rejected. One HTTP connection is serviced at a time, with 1 s
ingress and 2 s response deadlines. This bounds slow-client occupancy; it is
not a guaranteed HTTP STOP latency under radio loss or denial of service.

## Session ordering

Read state first. Each mutation except STOP supplies the current `epoch` and
an unsigned integer `seq` strictly greater than the returned `seq` (maximum
4294967295; no sequence wrap). Reference, disarm, configuration and STOP
rotate the epoch and reset the sequence. Boot chooses a new random epoch.

```json
{"op":"reference","epoch":12345,"seq":1,"pan":0,"tilt":0}
```

Use the returned epoch/sequence in the next command:

```json
{"op":"arm","epoch":12346,"seq":1}
{"op":"relative","epoch":12346,"seq":2,"pan":1,"tilt":0}
{"op":"heartbeat","epoch":12346,"seq":3}
```

These numbers are illustrative; never hard-code them. Only confirm reference
after physically aligning the mechanism. A syntactically valid, authorized
request consumes its sequence even if its operation is rejected. Read the
response before deciding what to do next.

Never automatically retry a mutation after timeout: the physical action might
already have started. Inspect state or issue STOP and recover deliberately.
Repeated sequence values return `stale`. Authenticated `{"op":"stop"}` always
latches STOP, even from an old session, and never releases coils.

Use one active controller. Concurrent tabs/bridges share the same sequence and
will conflict. Reading state does **not** renew the watchdog. Send heartbeat
every second while owning an armed session; never auto-arm on reconnect.

## Commands

| `op` | Additional fields | Behavior |
|---|---|---|
| `state` | none | Serial state request; HTTP normally uses GET |
| `reference` | `pan`, `tilt` degrees | Released only; acknowledge actual physical angles, clear latch |
| `arm` | none | Requires valid reference and cleared latch; energize phases |
| `disarm` | none | Cancel motion, release coils, invalidate reference |
| `move` | `pan`, `tilt` degrees; optional `speed`, `retarget` | Absolute, both axes arrive together; idle armed only unless `retarget` |
| `relative` | `pan`, `tilt` degree offsets; optional `speed`, `retarget` | Fractional sub-step requests accumulate; offsets add to the newest target |
| `center` | optional `speed`, `retarget` | Move to zero; never search for a sensor |
| `jog` | `pan`, `tilt` normalized speeds | Each zero or magnitude 0.025–1; renew unchanged vector within 500 ms |
| `heartbeat` | none | Renew the 5 s controller watchdog |
| `stop` | none; optional epoch/seq ignored | Immediate latched software stop, retain torque |
| `motion` | any of `speed`, `accel`, `jerk` (0.05–1) | Runtime multipliers for later moves; allowed any time, never stored |
| `settings` | fields below | Released only; validate, invalidate reference and persist |
| `preset_set` | `slot` 0–7, `pan`, `tilt`; optional `name` | Released only; save explicit coordinates |
| `preset_save` | `slot` 0–7; optional `name` | Save the present pose; referenced and at rest, armed or not |
| `preset_clear` | `slot` 0–7 | Forget a preset; idempotent |
| `preset_move` | `slot` 0–7; optional `speed`, `retarget` | Recall an existing in-range preset |

`{"op":"jog","epoch":12346,"seq":4,"pan":0,"tilt":0}` requests smooth
braking, including during a position move. Wait until `moving:false` before a
new direction or target. Lease expiry also brakes; STOP interrupts immediately.

## Motion profile

Every move is a seven-phase **jerk-limited S-curve**: acceleration ramps up and
down at no more than the configured jerk, instead of jumping, so the motors and
the printed gears see no step changes in torque. Speed, acceleration and jerk
ceilings are never exceeded, and a stop is planned from the exact present speed
and acceleration with the same ceilings. The profile is evaluated analytically
against a monotonic clock; nothing is queued or replayed.

* **Synchronized arrival.** For `move`, `relative`, `center` and `preset_move`, the axis
  with less to travel is stretched in time (speed, acceleration and jerk scale as
  1/k, 1/k², 1/k³) to coordinate arrival. Different profile shapes mean the
  pan/tilt path is not guaranteed to be a straight line. The 250 µs timer rebases the profile at every step, which lengthens a move
  by 0.1–2.8 % depending on the step rate (measured with an ideal timer across speed
  settings), so the two arrival times agree to within a few per cent, not exactly.
  Jog axes stay independent. `eta` reports the seconds of planned motion left, including
  a queued retarget's estimated move.
* **Runtime scales.** `motion` sets multipliers in 0.05–1 on the configured speed,
  acceleration and jerk. They apply to moves and jogs planned afterwards, can be changed
  while armed, need no re-reference, and reset to 1 at boot. A move's own `speed`
  (0.05–1) multiplies the runtime speed scale for that move only. Configured values
  stay hard ceilings: scales can only lower them.
* **Retargeting.** A move normally returns `busy` while another is in progress. With
  `"retarget":true` both axes brake smoothly, `queued` becomes true, each axis `target`
  shows the queued destination, and the newest target starts from wherever the axes
  come to rest. The last request wins, a relative offset adds to the pending target,
  and repeating the target already being approached changes nothing. STOP, `disarm`
  and a zero jog cancel the pending target; a jog cannot be started or retargeted over
  (`busy`). Wait for `moving:false` or `eta` as before when you do not send `retarget`.
* **Braking** (zero jog, lease expiry, retarget) plans each axis's stop with the move's
  ceilings before the synchronization stretch, so the axis that was slowed down stops as
  promptly as the leading one. The axes stop independently; during a brake the path is
  also not constrained to a straight line.
* **Jog release** now takes a little longer than a trapezoid did, because the stop ramps
  its own acceleration down: about 0.5–0.7 s from full speed with the default jerk.

## Presets and the last pose

Eight presets hold a pan/tilt pair and an optional name of up to 16 printable ASCII
characters other than `"` and `\` (so names never need escaping in JSON).
`preset_set` keeps its rule (released motors; explicit angles). A name
that is left out keeps the slot's existing name; `""` clears it. `preset_save` stores
the present estimate and needs a valid reference and a mechanism at rest; `preset_clear`
empties a slot. Saving and clearing work while armed: the settings are marked dirty
(`settings_dirty:true`) and the flash write happens at the next accepted command with the
motors released, normally `disarm`. Power loss before that loses the change.

`last_pose` holds where the mechanism rested when an **armed** session was last
released (`disarm`) with a valid reference and no motion in progress. A STOP at rest
keeps the pose (holding torque kept the position); a release after interrupted motion
or a timing fault records "no pose". Releasing motors that were not armed leaves the
stored hint alone, so it survives a reboot and an early safety release. An accepted
`arm` first erases the hint from flash, while the coils are still off: after a reset
during the session the mechanism could be anywhere, so no stale hint can survive one.
It is a hint only: boot and brownout still never restore a reference, and `reference`
always takes explicit angles.

Optional settings: `pan_steps`, `tilt_steps` (2000–6000 half-steps/geared motor
turn); `pan_min`, `pan_max`, `tilt_min`, `tilt_max` (degrees); `pan_speed`,
`tilt_speed` (degrees/s, at least 0.1); `pan_accel`, `tilt_accel` (0.1–20°/s²);
`pan_jerk`, `tilt_jerk` (1–500°/s³, default 80, reduced settings at most 80);
`pan_inverted`, `tilt_inverted`, `commissioned` (JSON booleans). Each range must
include zero and span at least 1°. Fixed external ratios cannot be changed by
API. Limits must remain within the CAD envelope; uncommissioned settings are
further restricted to the defaults described in the firmware README.

Omitted settings retain their current values. Invalid updates leave configuration
unchanged. Presets outside newly narrowed limits are invalidated. New settings
require a fresh physical reference. Flash writes are never made while armed.

## Responses and integration

Responses include `result`, `epoch`, `seq`, `armed`, `referenced`, `stopped`,
`moving`, `jogging`, `fault`, `commissioned`, `storage_ok`, `settings_dirty`,
`max_tick_gap_us`, `timing_faults`, two `axes` and eight `presets`.
Since 1.1.0 they also include `api_minor`, `queued`, `eta` (seconds), `motion`
(`speed`, `accel`, `jerk` scales), `max_tick_cost_us` (longest time one 250 µs motor
callback has spent in the controller, for bench qualification), `last_pose`
(`valid`, `pan`, `tilt`) and, per preset, `name`.
Each axis reports emitted `steps`, estimated `degrees`, requested `target`,
planned `velocity`, present `accel_now` (°/s²) and calibration/settings including `jerk`. Position fields are trustworthy
only as an **open-loop estimate** when `referenced:true`; no slip is detectable.

HTTP 200 means accepted, 400 means invalid/range failure, 401 means missing or
incorrect token, 404 means unknown path, and 409 means a state/session/storage
conflict. The JSON `result` distinguishes `busy`, `not_armed`, `not_referenced`,
`stopped`, `stale`, `invalid`, `range` and `storage`. A timing failure is visible
in `fault:"timing_fault"`; a subsequent move is rejected as stopped.

Use the API from a host bridge for OBS/Stream Deck automation. Keep the token
on the host, serialize commands, honor busy/latch states and send heartbeats
while waiting for long moves. Integrations must use the routes and stepper
command schema documented here. No WebSocket,
OTA, DHCP discovery service or camera streaming is implemented in this release.
