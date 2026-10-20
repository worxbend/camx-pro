"""Check release identity, 3MF build objects, plate spacing, and archived CAD."""
from collections import Counter
import hashlib
import itertools
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import numpy as np
import trimesh
from cad.config import ROOT, source_digest

OUT = Path("exports")
NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}


def build_meshes(path):
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
    assert root.get("unit") == "millimeter", path
    objects = {o.get("id"): o for o in root.findall("m:resources/m:object", NS)}
    result = []
    # Current exporter uses direct mesh build items. Refuse other layouts rather
    # than silently ignoring transforms or checking unreferenced resource meshes.
    for item in root.findall("m:build/m:item", NS):
        assert not item.get("transform"), f"Transform requires explicit handling: {path}"
        obj = objects[item.get("objectid")]
        assert obj.find("m:components", NS) is None, f"Nested assembly: {path}"
        vertices = [[float(v.get(k)) for k in ["x", "y", "z"]]
                    for v in obj.findall("m:mesh/m:vertices/m:vertex", NS)]
        faces = [[int(v.get(k)) for k in ["v1", "v2", "v3"]]
                 for v in obj.findall("m:mesh/m:triangles/m:triangle", NS)]
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        assert mesh.is_watertight and mesh.is_winding_consistent and mesh.body_count == 1
        assert mesh.volume > 0
        result.append((obj.get("name"), mesh))
    return result


def main():
    m = json.loads((OUT / "manifest.json").read_text())
    assert m["cad_source_sha256"] == source_digest()
    checksums = 0
    for line in (OUT / "checksums.sha256").read_text().splitlines():
        checksum, name = line.split("  ", 1)
        assert hashlib.sha256((OUT / name).read_bytes()).hexdigest() == checksum, name
        checksums += 1
    with ZipFile(OUT / "camx-pro-prototype.zip") as archive:
        assert archive.testzip() is None
        # Published P3 archives retain their old standalone layout; new packages
        # mirror the monorepo. Check source bytes in either layout, never zero files.
        prefix = "hardware/" if "hardware/exports/manifest.json" in archive.namelist() else ""
        assert json.loads(archive.read(prefix + "exports/manifest.json")) == m
        source_files = [name for name in archive.namelist()
                        if name.startswith(prefix + "cad/") and Path(name).suffix in {".py", ".json"}]
        expected = {prefix + "cad/" + path.name for path in (ROOT / "cad").iterdir()
                    if path.suffix in {".py", ".json"}}
        assert set(source_files) == expected, "Missing or unexpected archived CAD source"
        for name in source_files:
            local = ROOT / name.removeprefix(prefix)
            assert archive.read(name) == local.read_bytes(), name
    printed = {n: p for n, p in m["parts"].items() if p["printed"]}
    plate_parts, plates = [], []
    margin = m["parameters"]["printer"]["margin"]
    bed = np.asarray(m["parameters"]["printer"]["bed"])
    for name, info in printed.items():
        meshes = build_meshes(OUT / "parts" / (name + ".3mf"))
        assert len(meshes) == 1, name
        mesh = meshes[0][1]
        assert np.allclose(mesh.extents, info["print_bounds_mm"], atol=.15), name
        assert mesh.bounds[0, 2] >= -.001, name
        assert abs(mesh.volume-info["volume_mm3"])/info["volume_mm3"] < .03, name
    for plate in m["plates"]:
        meshes = build_meshes(OUT / "plates" / plate["file"])
        names = [n for n, _ in meshes]
        assert Counter(names) == Counter(plate["parts"]), plate["file"]
        plate_parts.extend(names)
        minimum_gap = None
        for name, mesh in meshes:
            lo, hi = mesh.bounds
            assert np.all(lo[:2] >= margin-.001) and np.all(hi[:2] <= bed[:2]-margin+.001)
            assert lo[2] >= -.001 and hi[2] <= bed[2]+.001
            assert np.allclose(mesh.extents, printed[name]["print_bounds_mm"], atol=.15)
        for (a, ma), (b, mb) in itertools.combinations(meshes, 2):
            overlap = np.minimum(ma.bounds[1, :2], mb.bounds[1, :2])-np.maximum(ma.bounds[0, :2], mb.bounds[0, :2])
            assert not np.all(overlap > .001), (plate["file"], a, b)
            gap = float(np.linalg.norm(np.maximum(-overlap, 0)))
            assert gap >= margin-.05, (plate["file"], a, b, gap)
            minimum_gap = gap if minimum_gap is None else min(minimum_gap, gap)
        plates.append({"file": plate["file"], "parts": names,
                       "minimum_xy_box_gap_mm": minimum_gap})
    assert Counter(plate_parts) == Counter(printed.keys()), "Missing/duplicated plate parts"
    report = {"status": "passed", "cad_source_sha256": source_digest(),
              "checksums_verified": checksums, "archived_cad_files": len(source_files),
              "individual_3mf_meshes": len(printed), "plate_layouts": plates,
              "limitations": ["Build-object geometry only: brims, supports and purge paths are not included."]}
    target = OUT / "reports/preprint"
    target.mkdir(parents=True, exist_ok=True)
    (target / "package-integrity.json").write_text(json.dumps(report, indent=2)+"\n")
    print(f"{checksums} checksums, {len(printed)} individual 3MF files, "
          f"{len(plates)} plates and archived CAD: passed")


if __name__ == "__main__":
    main()
