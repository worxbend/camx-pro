# CAMX Pro firmware API v1

The ESP32 controls movement only. The Anker C200 sends video directly to the
host over USB. This API replaces camx's servo pulse/calibration protocol.

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
| `move` | `pan`, `tilt` degrees | Absolute, both axes; idle armed only |
| `relative` | `pan`, `tilt` degree offsets | Idle armed only; fractional sub-step requests accumulate |
| `center` | none | Move to zero; never search for a sensor |
| `jog` | `pan`, `tilt` normalized speeds | Each zero or magnitude 0.025–1; renew unchanged vector within 500 ms |
| `heartbeat` | none | Renew the 5 s controller watchdog |
| `stop` | none; optional epoch/seq ignored | Immediate latched software stop, retain torque |
| `settings` | fields below | Released only; validate, invalidate reference and persist |
| `preset_set` | `slot` 0–7, `pan`, `tilt` | Released only; save explicit coordinates |
| `preset_move` | `slot` 0–7 | Recall an existing in-range preset |

`{"op":"jog","epoch":12346,"seq":4,"pan":0,"tilt":0}` requests smooth
braking, including during a position move. Wait until `moving:false` before a
new direction or target. Lease expiry also brakes; STOP interrupts immediately.

Optional settings: `pan_steps`, `tilt_steps` (2000–6000 half-steps/geared motor
turn); `pan_min`, `pan_max`, `tilt_min`, `tilt_max` (degrees); `pan_speed`,
`tilt_speed` (degrees/s, at least 0.1); `pan_accel`, `tilt_accel` (0.1–20°/s²);
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
Each axis reports emitted `steps`, estimated `degrees`, requested `target`,
planned `velocity` and calibration/settings. Position fields are trustworthy
only as an **open-loop estimate** when `referenced:true`; no slip is detectable.

HTTP 200 means accepted, 400 means invalid/range failure, 401 means missing or
incorrect token, 404 means unknown path, and 409 means a state/session/storage
conflict. The JSON `result` distinguishes `busy`, `not_armed`, `not_referenced`,
`stopped`, `stale`, `invalid`, `range` and `storage`. A timing failure is visible
in `fault:"timing_fault"`; a subsequent move is rejected as stopped.

Use the API from a host bridge for OBS/Stream Deck automation. Keep the token
on the host, serialize commands, honor busy/latch states and send heartbeats
while waiting for long moves. The old camx `/move`, `/jog`, servo pulse settings,
WebSocket client and OBS bridge are not drop-in compatible. No WebSocket,
OTA, DHCP discovery service or camera streaming is implemented in this release.
