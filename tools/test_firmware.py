"""Compile/run portable firmware checks, without a board or PlatformIO."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="camx-firmware-") as directory:
        for source in sorted((ROOT / "firmware/tests").glob("*_test.cpp")):
            binary = str(Path(directory) / source.stem)
            command = [os.environ.get("CXX", "clang++"), "-std=c++17", "-O1", "-g",
                       "-Wall", "-Wextra", "-Wpedantic", "-Werror",
                       "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
                       "-I", str(ROOT / "firmware/include"), str(source), "-o", binary]
            subprocess.run(command, check=True, cwd=ROOT)
            subprocess.run([binary], check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
