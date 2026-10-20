"""Exercise the packaged Glyphora app in a real PTY; verify terminal restoration."""
import fcntl
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import termios
import time

root = Path(__file__).resolve().parents[1]
jar = root / 'apps/tui/out/app/assembly.dest/out.jar'
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 34, 120, 0, 0))
before = termios.tcgetattr(slave)
process = subprocess.Popen(['java', '--enable-native-access=ALL-UNNAMED', '-jar', str(jar), '--demo'],
                           stdin=slave, stdout=slave, stderr=slave,
                           env={**os.environ, 'TERM': 'xterm-256color'})
output = bytearray()
try:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and b'CAMX PRO' not in output:
        if select.select([master], [], [], .1)[0]:
            output.extend(os.read(master, 65536))
        if process.poll() is not None:
            raise AssertionError(f'TUI exited early: {output.decode(errors="replace")}')
    assert b'CAMX PRO' in output, 'TUI did not render'
    os.write(master, b'\x03')  # Ctrl+C: run Glyphora/application cleanup.
    while process.poll() is None and time.monotonic() < deadline:
        if select.select([master], [], [], .1)[0]:
            output.extend(os.read(master, 65536))
    assert process.poll() == 0, f'TUI did not exit cleanly: {process.poll()}'
    assert termios.tcgetattr(slave) == before, 'Terminal attributes were not restored'
    print('Packaged Glyphora PTY: render, Ctrl+C exit, terminal restoration: PASS')
finally:
    if process.poll() is None:
        process.kill()
    process.wait()
    os.close(master)
    os.close(slave)
