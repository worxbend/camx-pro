# CAMX Pro terminal remote

A Scala 3 / Glyphora application for the ESP32 stepper controller. Requires JDK 25.
The pinned Mill launcher and published Maven dependencies need no sibling checkout.

```sh
./mill app.run --demo
./mill app.run --url http://DEVICE_IP
./mill app.test
./mill app.assembly
python3 scripts/test_environment.py
python3 scripts/test_pty.py
```

The packaged checks run after assembly, using only a loopback device fixture
and a demo terminal. The environment check verifies that an unrelated token
cannot configure this application.

Live mode prompts for the API token or reads `CAMX_PRO_API_TOKEN`. `--json` reads state
once without moving anything. Tab/mouse selects controls; Alt+arrows request bounded
angle steps and Alt+y/u/b/n diagonal ones (up-left, up-right, down-left, down-right);
Esc requests STOP; q quits outside text entry.

With firmware 1.1.0 (`api_minor` 1) the dashboard also offers runtime motion feel,
move speed, retargeting, named presets with *Save here* and *Clear*, the last-pose
hint and the jerk setting. With 1.0.0 firmware those rows show a notice and their
commands are never sent. Everything fits the 76×27 minimum terminal.

Behind a TLS-intercepting proxy the native Mill launcher may not trust the proxy's
certificate; `MILL_VERSION=1.1.9-jvm ./mill app.test` runs the JVM launcher, which uses
the JDK trust store.

Read the [operator guide](../../docs/controllers.md) for physical reference,
arming, presets, token handling and failure behavior. No hardware has been moved
by the automated tests. Demo positions are simulated.
