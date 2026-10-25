"""Release assets must only come from exports verified for the current CAD."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import release


class ReleaseTests(unittest.TestCase):
    def exports(self, digest, status="passed"):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / "manifest.json").write_text(json.dumps({"cad_source_sha256": digest}))
        for name in release.REPORTS:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(json.dumps({"status": status, "cad_source_sha256": digest}))
        return root

    def test_reject_stale_exports(self):
        with patch.object(release, "EXPORTS", self.exports("old")):
            with self.assertRaisesRegex(ValueError, "stale"):
                release.check_exports()

    def test_reject_failed_report(self):
        with patch.object(release, "EXPORTS", self.exports(release.source_digest(), "failed")):
            with self.assertRaisesRegex(ValueError, "not a passed report"):
                release.check_exports()

    def test_accept_current_exports(self):
        with patch.object(release, "EXPORTS", self.exports(release.source_digest())):
            release.check_exports()
