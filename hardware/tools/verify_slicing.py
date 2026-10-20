"""Headless PrusaSlicer geometry audit; temporary G-code is never released."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from cad.config import source_digest

OUT = Path("exports")
REPORTS = OUT / "reports/preprint"
CONFIG = Path("tools/preprint-slicer.ini")


def extrusion_bounds(text):
    """XY bounds of positive-extrusion linear segments (including their starts).

    Supports the G90/M82 or M83, G92 and linear output used by this audit.
    Reject arc or relative-XYZ output instead of returning misleading bounds.
    """
    xy = [None, None]
    e = 0.0
    relative_e = False
    points = []
    features = {}
    feature = "unknown"
    for raw in text.splitlines():
        if raw.startswith(";TYPE:"):
            feature = raw[6:].strip()
        line = raw.split(";", 1)[0].strip()
        if not line:
            continue
        cmd = line.split()[0]
        values = {key: float(value) for key, value in
                  re.findall(r"([XYZE])([+-]?(?:\d+(?:\.\d*)?|\.\d+))", line)}
        if cmd in {"G2", "G3", "G91"}:
            raise ValueError(f"Unsupported audit motion: {line}")
        if cmd == "M82":
            relative_e = False
        elif cmd == "M83":
            relative_e = True
        elif cmd == "G92":
            e = values.get("E", e)
            xy = [values.get("X", xy[0]), values.get("Y", xy[1])]
        elif cmd in {"G0", "G1"}:
            new_xy = [values.get("X", xy[0]), values.get("Y", xy[1])]
            delta = values.get("E", 0) if relative_e else values.get("E", e)-e
            if delta > 0 and new_xy != xy and None not in xy+new_xy:
                points.extend([xy, new_xy])
                features[feature] = features.get(feature, 0)+1
            xy = new_xy
            if "E" in values:
                e = values["E"] if not relative_e else e+values["E"]
    if not points:
        raise ValueError("No positive-extrusion XY movements")
    return [[min(p[i] for p in points) for i in range(2)],
            [max(p[i] for p in points) for i in range(2)]], features


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--slicer", required=True, type=Path)
    parser.add_argument("--plate", help="Optional plate filename for an individual diagnostic")
    parser.add_argument("--reuse-passed", action="store_true",
                        help="Reuse passed plates only when CAD, plate bytes, config and slicer version match")
    args = parser.parse_args()
    executable = str(args.slicer.resolve())
    manifest = json.loads((OUT / "manifest.json").read_text())
    digest = source_digest()
    assert manifest["cad_source_sha256"] == digest
    REPORTS.mkdir(parents=True, exist_ok=True)
    version = subprocess.run([executable, "--help"], capture_output=True, text=True,
                             check=True).stdout.splitlines()[0]
    config_sha = hashlib.sha256(CONFIG.read_bytes()).hexdigest()
    previous = {}
    previous_path = REPORTS / "slicing.json"
    if args.reuse_passed and previous_path.exists():
        prior = json.loads(previous_path.read_text())
        if (prior["cad_source_sha256"] == digest and prior["config_sha256"] == config_sha
                and prior["slicer_version"] == version):
            previous = {p["plate"]: p for p in prior["plates"] if p["status"] == "passed"}
    plates = [p["file"] for p in manifest["plates"]
              if not args.plate or p["file"] == args.plate]
    assert plates, "No matching plate"
    bed = manifest["parameters"]["printer"]["bed"]
    with tempfile.TemporaryDirectory(prefix="camx-slicer-audit-") as temporary:
        def run(plate):
            plate_sha = hashlib.sha256((OUT / "plates" / plate).read_bytes()).hexdigest()
            old = previous.get(plate)
            if old and old.get("plate_sha256") == plate_sha and not old.get("toolpath_conflict_reported", True):
                record = dict(old, reused_unchanged_pass=True)
                print(f"{plate}: passed (unchanged validated bytes)", flush=True)
                return record
            stem = Path(plate).stem
            folder = Path(temporary) / stem
            folder.mkdir()
            gcode = folder / "DO_NOT_PRINT.gcode"
            command = [executable, "--datadir", str(folder / "settings"),
                       "--threads", "2", "--load", str(CONFIG.resolve()),
                       "--dont-arrange", "--export-gcode", "--output", str(gcode),
                       str((OUT / "plates" / plate).resolve())]
            result = subprocess.run(command, capture_output=True, text=True, timeout=600)
            log = result.stdout + result.stderr
            (REPORTS / f"slicer-{stem}.log").write_text(log)
            record = {"plate": plate, "exit_code": result.returncode,
                      "plate_sha256": plate_sha,
                      "command": command, "status": "failed"}
            path_conflict = "gcode path conflicts found" in log.lower()
            record["toolpath_conflict_reported"] = path_conflict
            if result.returncode == 0 and gcode.is_file() and not path_conflict:
                text = gcode.read_text()
                bounds, features = extrusion_bounds(text)
                # Toolpath center bounds. Add half the configured nozzle width as
                # a simple margin screen; this is not a machine collision model.
                margin = min(bounds[0]+[bed[i]-bounds[1][i] for i in range(2)])
                record.update(
                    status="passed" if margin >= .2 else "outside_bed_margin",
                    extrusion_center_xy_bounds_mm=bounds,
                    minimum_extrusion_center_bed_margin_mm=margin,
                    positive_extrusion_segments_by_type=features,
                    toolpath_sha256=hashlib.sha256(text.encode()).hexdigest(),
                    slicer_statistics=[line[2:] for line in text.splitlines()
                                       if line.startswith(("; estimated printing time",
                                                           "; total filament used",
                                                           "; filament used [g]",
                                                           "; filament used [mm]"))],
                )
            print(f"{plate}: {record['status']}", flush=True)
            return record
        with ThreadPoolExecutor(max_workers=2) as pool:
            records = list(pool.map(run, plates))
    report = {
        "status": "passed" if all(r["status"] == "passed" for r in records) else "failed",
        "scope": "all plates" if not args.plate else args.plate,
        "cad_source_sha256": digest, "slicer_version": version,
        "configuration": str(CONFIG), "config_sha256": config_sha,
        "plates": records, "temporary_gcode_deleted": True,
        "limitations": [
            "Generic geometry-only configuration, not a Bambu machine/material profile.",
            "Supports, brim and extruded path bounds checked; no printer connected.",
            "No qualification of support removal, adhesion, temperatures, tolerances or tooth strength.",
            "G-code was created only in a temporary directory and deleted, not released for printing.",
        ],
    }
    assert digest == source_digest(), "CAD changed during audit"
    name = "slicing.json" if not args.plate else f"slicing-{Path(args.plate).stem}.json"
    (REPORTS / name).write_text(json.dumps(report, indent=2)+"\n")
    raise SystemExit(report["status"] != "passed")


if __name__ == "__main__":
    main()
