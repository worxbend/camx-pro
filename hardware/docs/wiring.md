# Power and cable routing

## Electrical architecture

```text
Verified 5 V supply
  → USB-C sink breakout → fuse → distribution node
                                  ├─ ULN2003 PAN → pan motor
                                  ├─ ULN2003 TILT → tilt motor
                                  └─ isolated/selected ESP32 5 V input
All motor-control grounds join at the distribution node.
Webcam USB → host computer, separate from the motor-control power distribution.
```

Do not pass motor current through the ESP32 board. Connect the driver's
flyback-diode COM appropriately to the motor supply; check each module's actual
wiring. The [TI ULN2003A documentation](https://www.ti.com/lit/ds/symlink/uln2003a.pdf)
describes the Darlington outputs and clamp diodes. Account for voltage drop,
simultaneous coil currents and driver package heating.

The small breakout's appearance does not establish pinout or current capability.
Confirm 5 V/GND by documentation and continuity testing before connection.
For a plain USB-C sink, independent CC resistors and source current advertisement
must be handled correctly; two resistors alone do not establish permission to
draw 3 A. See [TI USB Type-C guidance](https://www.ti.com/lit/SLYY228).

Use one selected power path to the ESP32 while programming. Do not assume its
USB input is isolated from its 5 V pin. The
[Espressif DevKitC guide](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html)
describes power-source alternatives; verify the owner's clone board separately.
Bulk capacitance and local bypass parts belong near the drivers and distribution
node, with values selected after startup/supply-sag measurements.

## P3 cable route

The fixed pan motor and both drivers stay in the base. Only tilt leads, webcam USB and any future sensors cross the moving interface. Never route cables through planetary teeth or the sun journal.

`cad/cables.py` defines two constant-length ideal rolling paths. See `exports/drawings/cable-routing.svg` and the source-hashed tube/mesh report. The motor bundle is provisionally Ø3 mm atZ75, with inner/outer centerline radii29/53 mm and12 mm return radius. USB is provisionally Ø4 mm atZ81, radii29/69 mm and20 mm return radius. The fixed tray, shelf and roof are separate; the inner rotating ceiling has two removable halves. Sidewalls and shallow layer clearances limit cable lifting.

Fixed split clamps sit below the entry bends. Moving risers terminate in a split clamp inside the passive arm. The platform/skirt window is16×20 mm; the inner service port is20 mm. Lay cables in before fitting roofs and caps. Use thin compliant liners; the nominal0.2 mm radial clamp allowance is not itself a gripping fit. Confirm actual motor plug passage before assembly.

Route stationary tails below the guide tray to their drivers/external exit, clear of gears and populated boards. Keep an accessible tilt service loop behind the webcam, free of its connector and shutter. **These tails and the camera tilt loop remain unmodeled and require manual sweep qualification.** The mathematical rolling paths do not predict flexible cable stiffness, drag or wear.

The webcam exits at rearX0 through a seam-open notch and removable split inserts. The intact12×8 mm reference plug can be oriented8 mm across the opening; no cable cutting is required. The power connector remains separate atX36. Verify the actual breakout pinout and connector location.

Hand-sweep every extreme and combined pose repeatedly, initially without the real camera. Record cable length, bend radius, rubbing, clamp grip and drag torque. Do not allow continuous pan rotation. Open-loop step counts cannot detect slips or a snag; power loss invalidates the reference. The [firmware wiring and commissioning guide](../../firmware/README.md) specifies GPIO16/17/18/19 for pan and GPIO21/22/23/25 for tilt, in ULN2003 IN1–IN4 order. The implementation uses manual reference and reduced initial limits; actual directions, limits, stopping and electrical behavior require bench qualification.
