"""Corrupt or unexpected release bundles must never reach the public directory."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from tools.website import assets


class AssetIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_reject_corrupt_bundle(self):
        archive = self.root / 'corrupt.zip'
        archive.write_bytes(b'not the pinned release')
        with self.assertRaisesRegex(ValueError, 'checksum/size'):
            assets.fetch(archive)

    def test_reject_changed_allowlist(self):
        lock = json.loads(assets.LOCK.read_text())
        lock['files'].append('credentials.h')
        path = self.root / 'assets.lock.json'
        path.write_text(json.dumps(lock))
        with patch.object(assets, 'LOCK', path):
            with self.assertRaisesRegex(ValueError, 'allowlist'):
                assets.fetch(self.root / 'unused.zip')

    def test_reject_zip_traversal_even_with_matching_checksum(self):
        archive = self.root / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('../unexpected', 'x')
        lock = json.loads(assets.LOCK.read_text())
        lock.update(bytes=archive.stat().st_size, sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        path = self.root / 'assets.lock.json'
        path.write_text(json.dumps(lock))
        with patch.object(assets, 'LOCK', path):
            with self.assertRaisesRegex(ValueError, 'Unexpected or duplicate'):
                assets.fetch(archive)
