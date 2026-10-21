# CAMX Pro hardware and control contract

This repository owns the mechanical design and [ESP32 firmware](../../firmware/README.md).
See the [API](../../firmware/docs/api.md) and [software verification](../../firmware/docs/verification.md).
The CAD viewer remains separate and cannot command motors. No hardware was flashed.

## Implemented controls

- Wi-Fi setup, authenticated HTTP control, serial diagnostics and state reporting.
- Independent/combined absolute moves, relative moves, configurable speed,
  acceleration, presets and an explicit center command.
- Held-jog lease expiration, connection watchdog, arm/disarm states and a
  deliberately latched stop. Late commands must not restart a stopped axis.
- Controller epochs to reject stale commands; validation of finite numbers,
  ranges and malformed requests.
- Browser remote controls, calibration, persistent settings and eight presets.
  Both remotes implement the CAMX Pro command protocol.

## Stepper implementation

The firmware drives two 28BYJ-48 steppers with
nonblocking four-phase half-step scheduling through ULN2003. It does not use
servo PWM or current-controlled microstepping.

Motor calibration, fixed external reduction, direction, speed and acceleration
are separate parameters. Nominal 4096 half-steps per geared motor output turn
is provisional. P3 uses 4:1 pan and 2:1 tilt reduction; the internal motor
gearbox must not be counted twice. Both motors need independent calibration,
current/temperature tests and load tests. The build checks generated constants
against CAD; a changed mechanical fingerprint invalidates old stored settings.

CAMX Pro firmware 1.0.0 used independent rest-to-rest trapezoids.
Firmware 1.1.0 replaces them with jerk-limited S-curves,
synchronized pan/tilt arrival and opt-in retargeting (`"retarget":true`; without
it a move during motion is still `busy`); see the [firmware API](../../firmware/docs/api.md).
The scheduler does not replay overdue steps.

Implemented states:
`unreferenced → referenced_disarmed → armed → moving`, with a latched
`stopped` state. Boot, brownout, suspected lost steps and manual displacement
invalidate absolute position. A disarm policy must consider gravity: releasing
coils can drop an unbalanced camera.

## Reference and limits

Distinguish **reference search**, **manual reference acknowledgment** and
**go to center**. The `center` command moves to zero using an established
reference; it does not find a physical home. Without sensors, require the operator to align witness
marks before acknowledging reference; the device must never infer it from
stored step counts after a reboot.

Automatic sensor homing remains unimplemented. Adding it must include approach, debounce, back-off, slow re-approach,
timeout, maximum travel, wrong-direction/stuck-sensor detection and cancellation.
Mount details are pending hardware selection. Software limits require a valid
reference; use reduced initial travel during commissioning.

## Validation boundary

Native tests cover coil sequence/reversal, fractional accumulation,
acceleration bounds, concurrent axes, limits, stop behavior, stale-command
rejection, watchdog expiry, malformed packets, storage and invalid configuration.
Browser tests exercise the portable controller. Unsupported sensor homing is rejected.
Remaining hardware tests: direction, repeatability, loss of steps, loaded speed/torque,
coil heating, Wi-Fi behavior under load and loss-of-power behavior.
No device flash or powered movement has been performed.
