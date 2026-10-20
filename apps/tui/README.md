# CAMX Pro terminal remote

A Scala 3 / Glyphora application for the ESP32 stepper controller. Requires JDK 25.
The pinned Mill launcher and published Maven dependencies need no sibling checkout.

```sh
./mill app.run --demo
./mill app.run --url http://DEVICE_IP
./mill app.test
./mill app.assembly
```

Live mode prompts for the API token or reads `CAMX_API_TOKEN`. `--json` reads state
once without moving anything. Tab/mouse selects controls; Alt+arrows requests
bounded angle steps; Esc requests STOP; q quits outside text entry.

Read the [operator guide](../../docs/controllers.md) for physical reference,
arming, presets, token handling and failure behavior. No hardware has been moved
by the automated tests. Demo positions are simulated.
