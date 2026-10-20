"""Screen the actual exported print orientations, without claiming slicer approval.

Run: python -m tools.verify_print_layers
Install requirements-audit.txt first. No geometry or release files are modified.
"""
import json
from pathlib import Path
import numpy as np
import trimesh
from shapely import union_all
from shapely.geometry import GeometryCollection

from cad.config import source_digest

OUT = Path("exports")
REPORTS = OUT / "reports" / "preprint"


def polygons_at(path):
    if path is None:
        return GeometryCollection()
    shapes = list(path.polygons_full)
    return union_all(shapes) if shapes else GeometryCollection()


def disk_diameter(shape):
    """Approximate largest inscribed disk, a span indicator, not bridge length."""
    if shape.is_empty:
        return 0.0
    x0, y0, x1, y1 = shape.bounds
    lo, hi = 0.0, min(x1-x0, y1-y0)/2
    for _ in range(12):
        mid = (lo+hi)/2
        if shape.buffer(-mid).is_empty:
            hi = mid
        else:
            lo = mid
    return 2*lo


def inspect(mesh, layer):
    heights = np.arange(layer/2, float(mesh.bounds[1, 2]), layer)
    paths = mesh.section_multiplane([0, 0, 0], [0, 0, 1], heights)
    previous = GeometryCollection()
    peak = {"area_mm2": 0, "z_mm": 0, "inscribed_disk_mm": 0}
    islands = []
    failures = []
    overhang_layers = 0
    bed_area = 0.0
    for index, (height, path) in enumerate(zip(heights, paths)):
        try:
            current = polygons_at(path)
            if not current.is_valid:
                raise ValueError("Invalid layer polygon")
        except Exception as exc:
            failures.append({"z_mm": float(height), "error": str(exc)})
            previous = GeometryCollection()
            continue
        if index == 0:
            bed_area = current.area
        else:
            # 45 degrees from vertical: one layer of horizontal growth per layer.
            unsupported = current.difference(previous.buffer(layer))
            if unsupported.area > .5:
                overhang_layers += 1
            if unsupported.area > peak["area_mm2"]:
                peak = {"area_mm2": float(unsupported.area), "z_mm": float(height),
                        "inscribed_disk_mm": disk_diameter(unsupported)}
            pieces = [current] if current.geom_type == "Polygon" else list(current.geoms)
            for piece in pieces:
                if piece.area > .5 and piece.intersection(previous).area < 1e-5:
                    islands.append({"z_mm": float(height), "area_mm2": float(piece.area)})
        previous = current
    # These are full-solid mesh volumes, not an infill estimate.
    return {"layers": len(heights), "first_layer_area_mm2": float(bed_area),
            "solid_volume_cm3": float(mesh.volume/1000),
            "layers_exceeding_45_degree_growth": overhang_layers,
            "largest_unsupported_patch": peak,
            "new_islands_without_previous_layer_contact": islands,
            "section_errors": failures}


def main():
    manifest = json.loads((OUT / "manifest.json").read_text())
    digest = source_digest()
    assert manifest["cad_source_sha256"] == digest, "Stale exported geometry"
    layer = manifest["parameters"]["printer"]["layer"]
    result = {"cad_source_sha256": digest, "layer_mm": layer,
              "status": "screened", "parts": {},
              "limitations": [
                  "Geometric layer screening; not a Bambu Studio profile or G-code approval.",
                  "45-degree growth flags supports/bridges; it does not predict print success.",
                  "Inscribed disk diameter is only an unsupported-area span indicator.",
                  "Material, extrusion width, cooling, adhesion and support removal are unqualified."
              ]}
    for name, info in manifest["parts"].items():
        if not info["printed"]:
            continue
        mesh = trimesh.load_mesh(OUT / "parts" / f"{name}.stl", process=True)
        result["parts"][name] = inspect(mesh, layer)
        part = result["parts"][name]
        print(f"{name}: {part['layers']} layers; "
              f"{len(part['section_errors'])} section errors; "
              f"{part['largest_unsupported_patch']['area_mm2']:.1f} mm² peak overhang",
              flush=True)
    if any(p["section_errors"] for p in result["parts"].values()):
        result["status"] = "incomplete"
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "print-layers.json").write_text(json.dumps(result, indent=2)+"\n")


if __name__ == "__main__":
    main()
