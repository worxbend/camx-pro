"""A corrupt or unexpected release bundle must never reach the public directory."""
import hashlib
import json
import zipfile

import pytest
from tools import site_assets


def test_reject_corrupt_bundle(tmp_path):
    archive = tmp_path / 'corrupt.zip'
    archive.write_bytes(b'not the pinned release')
    with pytest.raises(ValueError, match='checksum/size'):
        site_assets.fetch(archive)


def test_reject_changed_allowlist(tmp_path, monkeypatch):
    lock = json.loads(site_assets.LOCK.read_text())
    lock['files'].append('credentials.h')
    path = tmp_path / 'assets.lock.json'
    path.write_text(json.dumps(lock))
    monkeypatch.setattr(site_assets, 'LOCK', path)
    with pytest.raises(ValueError, match='allowlist'):
        site_assets.fetch(tmp_path / 'unused.zip')


def test_reject_zip_traversal_even_with_matching_checksum(tmp_path, monkeypatch):
    archive = tmp_path / 'bad.zip'
    with zipfile.ZipFile(archive, 'w') as bundle:
        bundle.writestr('../unexpected', 'x')
    lock = json.loads(site_assets.LOCK.read_text())
    lock.update(bytes=archive.stat().st_size, sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
    path = tmp_path / 'assets.lock.json'
    path.write_text(json.dumps(lock))
    monkeypatch.setattr(site_assets, 'LOCK', path)
    with pytest.raises(ValueError, match='Unexpected or duplicate'):
        site_assets.fetch(archive)
