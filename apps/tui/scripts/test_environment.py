"""Verify the packaged CLI reads only CAMX Pro credentials against a loopback fixture."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[3]
JAR = ROOT / "apps/tui/out/app/assembly.dest/out.jar"
STATE = (ROOT / "contracts/state-v1.json").read_bytes()


class EnvironmentTests(unittest.TestCase):
    def test_project_token_is_required_and_unrelated_token_is_ignored(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(STATE)))
                self.end_headers()
                self.wfile.write(STATE)

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                env = {key: value for key, value in os.environ.items()
                       if key not in {"CAMX_API_TOKEN", "CAMX_PRO_API_TOKEN"}}
                env["CAMX_API_TOKEN"] = "unrelated-token-123456"
                command = ["java", "--enable-native-access=ALL-UNNAMED", "-jar", str(JAR),
                           "--url", f"http://127.0.0.1:{server.server_port}", "--json"]
                with tempfile.TemporaryDirectory(prefix="camx-pro-tui-") as directory:
                    result = subprocess.run(command, input="", capture_output=True, text=True,
                                            cwd=directory, env=env, timeout=15)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(received, [])
                    env["CAMX_PRO_API_TOKEN"] = "pro-test-token-123456"
                    result = subprocess.run(command, input="", capture_output=True, text=True,
                                            cwd=directory, env=env, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('"firmware": "camx-pro-', result.stdout)
                    self.assertEqual(received, [("/api/state", "Bearer pro-test-token-123456")])
            finally:
                server.shutdown()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
