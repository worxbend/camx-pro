"""Compile network-enabled and physical-stop branches in an isolated fixture.

Only fake credentials are created. This tool never uploads or reads credentials.h.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    pio = shutil.which("pio")
    if pio is None:
        candidate = ROOT / ".venv/bin/pio"
        if candidate.exists():
            pio = str(candidate)
    if pio is None:
        raise SystemExit("Install PlatformIO 6.2.0 first.")
    with tempfile.TemporaryDirectory(prefix="camx-compile-fixture-") as directory:
        fixture = Path(directory)
        shutil.copytree(ROOT / "firmware", fixture / "firmware",
                        ignore=shutil.ignore_patterns(".pio", "credentials.h", "web_ui.hpp"))
        (fixture / "hardware/cad").mkdir(parents=True)
        (fixture / "tools/contracts").mkdir(parents=True)
        shutil.copyfile(ROOT / "hardware/cad/parameters.json", fixture / "hardware/cad/parameters.json")
        shutil.copyfile(ROOT / "tools/contracts/firmware.py", fixture / "tools/contracts/firmware.py")
        (fixture / "firmware/include/credentials.h").write_text(
            '#pragma once\nconstexpr char WIFI_SSID[] = "CAMX-COMPILE-FIXTURE";\n'
            'constexpr char WIFI_PASSWORD[] = "not-a-real-password";\n'
            'constexpr char API_TOKEN[] = "compile-fixture-token-not-for-deployment";\n')
        board = fixture / "firmware/include/board.hpp"
        original = board.read_text()
        needle = "inline constexpr int stopPin = -1;"
        if original.count(needle) != 1:
            raise SystemExit("Update compile fixture for the changed board configuration.")
        board.write_text(original.replace(needle, "inline constexpr int stopPin = 32;"))
        subprocess.run([pio, "run", "-d", str(fixture / "firmware"), "-e", "esp32dev"], check=True)
    print("Configured Wi-Fi + GPIO32 stop compile fixture: PASS (temporary binary removed)")


if __name__ == "__main__":
    main()
