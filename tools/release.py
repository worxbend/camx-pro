"""Collect verified exports into GitHub release assets under release/<tag>/."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.cad.config import source_digest  # stdlib-only configuration, no CAD kernel
from tools.website import assets

EXPORTS = ROOT / "hardware/exports"
REPORTS = ("reports/preprint/package-integrity.json", "reports/preprint/slicing.json")


def check_exports():
    digest = source_digest()
    if json.loads((EXPORTS / "manifest.json").read_text())["cad_source_sha256"] != digest:
        raise ValueError("Exports are stale; run cad.export and the verification tools first.")
    for name in REPORTS:
        report = json.loads((EXPORTS / name).read_text())
        if report["status"] != "passed" or report["cad_source_sha256"] != digest:
            raise ValueError(f"{name} is not a passed report for the current CAD.")


def archive(out, files, base):
    if not files:
        raise ValueError(f"No files for {out.name}")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in files:
            bundle.write(path, path.relative_to(base).as_posix())
    return out


def build(tag):
    check_exports()
    out = ROOT / "release" / tag
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    printed = EXPORTS / "printed-hardware"
    made = [
        archive(out / f"camx-pro-{tag}-print-plates.zip", sorted(EXPORTS.glob("plates/*.3mf")), EXPORTS),
        archive(out / f"camx-pro-{tag}-parts-3mf.zip", sorted(EXPORTS.glob("parts/*.3mf")), EXPORTS),
        archive(out / f"camx-pro-{tag}-printed-substitutes.zip",
                sorted(p for p in printed.rglob("*") if p.is_file()), EXPORTS),
        Path(shutil.copy2(EXPORTS / "camx-pro-prototype.zip", out / f"camx-pro-{tag}-prototype.zip")),
        Path(shutil.copy2(EXPORTS / "engineering.pdf", out / f"camx-pro-{tag}-engineering.pdf")),
    ]
    made.append(Path(shutil.move(assets.pack(tag), out)))
    sums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in made)
    (out / "SHA256SUMS").write_text(sums)
    print(sums, end="")
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="GitHub release tag, for example p3.1")
    build(parser.parse_args().tag)
