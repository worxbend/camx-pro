"""Separate support-intensive parts after CAD export, preserving named 3MF meshes."""
import copy
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from cad.config import source_digest

OUT = Path("exports")
URI = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
NS = {"m": URI}
ET.register_namespace("", URI)


def write_selection(path, entries, root, names, center=False, spread=False):
    selected = copy.deepcopy(root)
    resources = selected.find("m:resources", NS)
    objects = {o.get("id"): o for o in resources.findall("m:object", NS)}
    keep = {key for key, obj in objects.items() if obj.get("name") in names}
    assert len(keep) == len(names), names
    build = selected.find("m:build", NS)
    for item in list(build):
        if item.get("objectid") not in keep:
            build.remove(item)
        else:
            assert item.get("transform") is None
    x = y = 12.0
    row = 0.0
    for key, obj in objects.items():
        if key not in keep:
            resources.remove(obj)
        elif center or spread:
            vertices = obj.findall("m:mesh/m:vertices/m:vertex", NS)
            assert vertices and obj.find("m:components", NS) is None
            axes = [[float(v.get(axis)) for v in vertices] for axis in ["x", "y"]]
            widths = [max(values)-min(values) for values in axes]
            if spread:
                if x+widths[0] > 168:
                    x = 12.0
                    y += row+20
                    row = 0.0
                assert y+widths[1] <= 168, "Small-part support layout needs another plate"
            for i, axis in enumerate(["x", "y"]):
                values = axes[i]
                delta = ([x, y][i]-min(values) if spread
                         else 90-(min(values)+max(values))/2)
                for vertex, value in zip(vertices, values):
                    vertex.set(axis, str(value+delta))
            if spread:
                x += widths[0]+20
                row = max(row, widths[1])
    payload = ET.tostring(selected, encoding="utf-8", xml_declaration=True)
    temporary = path.with_suffix(".3mf.tmp")
    with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, payload if name == "3D/3dmodel.model" else data)
    temporary.replace(path)


def main():
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    assert manifest["cad_source_sha256"] == source_digest(), "Stale export"
    # Its tall open tray generates support beyond the simple CAD bounding box.
    # The original 8 mm part spacing produced a support/toolpath conflict.
    name = "usb_power_tray"
    plate = next(p for p in manifest["plates"] if name in p["parts"])
    if len(plate["parts"]) > 1:
        path = OUT / "plates" / plate["file"]
        with ZipFile(path) as archive:
            entries = {n: archive.read(n) for n in archive.namelist()}
        root = ET.fromstring(entries["3D/3dmodel.model"])
        remaining = [n for n in plate["parts"] if n != name]
        next_index = max(int(Path(p["file"]).stem.rsplit("-", 1)[1])
                         for p in manifest["plates"])+1
        new_file = f"a1-mini-plate-{next_index:02}.3mf"
        write_selection(OUT / "plates" / new_file, entries, root, [name], center=True)
        write_selection(path, entries, root, remaining)
        plate["parts"] = remaining
        manifest["plates"].append({"file": new_file, "parts": [name]})
    preparation = manifest.get("plate_preparation", {})
    if preparation.get("small_part_gap_mm") != 20:
        small_plate = next(p for p in manifest["plates"] if "fixed_motor_clamp" in p["parts"])
        path = OUT / "plates" / small_plate["file"]
        with ZipFile(path) as archive:
            entries = {n: archive.read(n) for n in archive.namelist()}
        root = ET.fromstring(entries["3D/3dmodel.model"])
        write_selection(path, entries, root, small_plate["parts"], spread=True)
    manifest["plate_preparation"] = {
        "tool": "python -m tools.prepare_print_plates",
        "isolated_support_parts": [name],
        "small_part_gap_mm": 20,
        "small_part_edge_margin_mm": 12,
        "reason": "Raised tray and clamp support toolpaths exceeded the original inter-part gap.",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2)+"\n")
    print(f"{len(manifest['plates'])} plates; USB power tray isolated for supports.")


if __name__ == "__main__":
    main()
