"""Package or fetch the allowlisted, checksum-pinned CAD assets for GitHub Pages."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from hardware.cad.config import source_digest  # stdlib-only configuration, no CAD kernel

LOCK = ROOT / "apps/site/assets.lock.json"
FILES = (
    "manifest.json", "assembly/camx-pro.glb", "assembly/camx-pro.step",
    "assembly/planetary-actuator.step", "engineering.pdf", "camx-pro-prototype.zip",
    "images/three_quarter.png", "images/planetary_actuator.png", "images/exploded.png",
    "images/cutaway.png", "images/electronics.png",
)


def pack(tag):
    source = ROOT / "hardware/exports"
    manifest = json.loads((source / "manifest.json").read_text())
    if manifest["cad_source_sha256"] != source_digest():
        raise ValueError("Exports are stale; rebuild and verify the CAD before publishing.")
    for name in FILES:
        if not (source / name).is_file():
            raise ValueError(f"Missing site asset: {name}")
    out = ROOT / f"release/camx-pro-{tag}-web-assets.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in FILES:
            entry = zipfile.ZipInfo(name, date_time=(2026, 10, 20, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, (source / name).read_bytes())
    with out.open("rb") as data:
        digest = hashlib.file_digest(data, "sha256").hexdigest()
    lock = {
        "url": f"https://github.com/worxbend/camx-pro/releases/download/{tag}/{out.name}",
        "bytes": out.stat().st_size,
        "sha256": digest,
        "cad_source_sha256": source_digest(),
        "files": list(FILES),
    }
    LOCK.write_text(json.dumps(lock, indent=2) + "\n")
    print(f"Prepared {out} ({lock['bytes']:,} bytes)")
    return out


def fetch(archive=None):
    lock = json.loads(LOCK.read_text())
    if lock["cad_source_sha256"] != source_digest() or lock["files"] != list(FILES):
        raise ValueError("Website assets do not match the current CAD/source allowlist. Publish a new verified bundle.")
    if not lock["url"].startswith("https://github.com/worxbend/camx-pro/releases/download/"):
        raise ValueError("Asset URL must belong to this repository's GitHub releases.")
    with tempfile.TemporaryDirectory(prefix="camx-pages-") as directory:
        temp = Path(directory)
        download = Path(archive) if archive else temp / "assets.zip"
        if not archive:
            request = urllib.request.Request(lock["url"], headers={"User-Agent": "camx-pro-pages"})
            with urllib.request.urlopen(request, timeout=90) as response, download.open("wb") as out:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > lock["bytes"]:
                        raise ValueError("Download exceeds pinned asset size")
                    out.write(chunk)
        with download.open("rb") as data:
            digest = hashlib.file_digest(data, "sha256").hexdigest()
        if download.stat().st_size != lock["bytes"] or digest != lock["sha256"]:
            raise ValueError("Website asset checksum/size mismatch")
        staging = temp / "downloads"
        with zipfile.ZipFile(download) as bundle:
            if sorted(bundle.namelist()) != sorted(FILES):
                raise ValueError("Unexpected or duplicate entries in website bundle")
            if sum(info.file_size for info in bundle.infolist()) > 180 * 1024 * 1024:
                raise ValueError("Unpacked bundle exceeds size limit")
            for name in FILES:
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(name) as data, target.open("wb") as out:
                    shutil.copyfileobj(data, out)
        manifest = json.loads((staging / "manifest.json").read_text())
        if manifest["cad_source_sha256"] != lock["cad_source_sha256"]:
            raise ValueError("Model manifest does not match the asset lock")
        dest = ROOT / "apps/site/public/downloads"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(staging, dest)
    print(f"Verified and staged {len(FILES)} site assets")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["pack", "fetch"])
    parser.add_argument("--archive", type=Path, help="Verify a local bundle instead of downloading")
    parser.add_argument("--tag", help="GitHub release tag that will host the packed bundle")
    args = parser.parse_args()
    if args.command == "pack" and not args.tag:
        parser.error("pack requires --tag")
    pack(args.tag) if args.command == "pack" else fetch(args.archive)
