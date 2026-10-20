Import("env")
import subprocess
import sys
from pathlib import Path
root = Path(env["PROJECT_DIR"]).parent
subprocess.run([sys.executable, str(root / "tools/contracts/firmware.py"), "--check"], check=True)
html = (root / "firmware/web/index.html").read_text()
assert ')CAMXUI"' not in html
(root / "firmware/include/web_ui.hpp").write_text('#pragma once\ninline constexpr char webUi[] = R"CAMXUI(' + html + ')CAMXUI";\n')
