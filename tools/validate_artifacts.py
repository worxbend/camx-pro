"""Check manufactured meshes, round trips and actual A1 mini plate extents."""
import json
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile
import numpy as np
import trimesh
from build123d import import_step
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from cad.assembly import build
from cad.config import load
from cad.config import source_digest

OUT = Path("exports")
NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}


def adaptive_volume(shape):
    """Use adaptive integration for curved faces whose default mass varies."""
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape.wrapped, properties, 1e-9, True, False)
    return properties.Mass()


def equivalent_boundary(original, imported):
    """Require matching bounds and empty exact differences in both directions."""
    a, b = original.bounding_box(), imported.bounding_box()
    if not np.allclose([list(a.min), list(a.max)], [list(b.min), list(b.max)],
                       atol=1e-5, rtol=0):
        return False
    return all(len((first-second).solids()) == 0
               for first, second in [(original, imported), (imported, original)])


def check_3mf(path):
    with ZipFile(path) as archive:
        xml = ET.fromstring(archive.read("3D/3dmodel.model"))
    assert xml.get("unit") == "millimeter", path
    points = [[float(v.get(k)) for k in ("x", "y", "z")]
              for v in xml.findall(".//m:vertex", NS)]
    return np.asarray(points)


def main():
    manifest = json.loads((OUT / "manifest.json").read_text())
    assert manifest["cad_source_sha256"] == source_digest(), "Stale CAD export"
    report = {"status": "passed", "cad_source_sha256": source_digest(),
              "parts": {}, "plates": []}
    originals = None
    for name, spec in manifest["parts"].items():
        if not spec["printed"]:
            continue
        mesh = trimesh.load_mesh(OUT / "parts" / f"{name}.stl", process=True)
        assert mesh.is_watertight and mesh.is_winding_consistent, name
        assert mesh.body_count == 1 and mesh.volume > 0, name
        relative = abs(mesh.volume-spec["volume_mm3"])/spec["volume_mm3"]
        assert relative < .03, (name, relative)
        assert np.allclose(mesh.extents, spec["print_bounds_mm"], atol=.15), name
        assert mesh.bounds[0, 2] >= -.001, name
        step = import_step(OUT / "parts" / f"{name}.step")
        assert step.is_valid and len(step.solids()) == 1, name
        step_relative = abs(step.volume-spec["volume_mm3"])/spec["volume_mm3"]
        integration = "default"
        equivalence = "volume_within_1e-5"
        if step_relative >= 1e-5:
            # STEP can split spline faces and change the default quadrature.
            # Recompute both shapes adaptively; keep the same acceptance limit.
            if originals is None:
                originals, _ = build(load())
            original_volume = adaptive_volume(originals[name].shape)
            step_relative = abs(adaptive_volume(step)-original_volume)/original_volume
            integration = "adaptive_1e-9"
        if step_relative >= 1e-5:
            # Trimmed offset surfaces can give different quadrature despite
            # identical boundaries. Do not relax the volume tolerance: require
            # the exact B-rep differences to be empty in both directions.
            assert equivalent_boundary(originals[name].shape, step), (name, step_relative)
            equivalence = "matching_bounds_and_empty_bidirectional_brep_difference"
        check_3mf(OUT / "parts" / f"{name}.3mf")
        report["parts"][name] = {"watertight": True, "volume_error_fraction": relative,
                                  "step_roundtrip": True,
                                  "step_volume_error_fraction": step_relative,
                                  "step_volume_integration": integration,
                                  "step_equivalence_method": equivalence}
        print(f"{name}: mesh and STEP passed ({equivalence})", flush=True)
    bed = np.array(manifest["parameters"]["printer"]["bed"])
    for plate in manifest["plates"]:
        vertices = check_3mf(OUT / "plates" / plate["file"])
        assert np.all(vertices.min(axis=0) >= -.001), plate
        assert np.all(vertices.max(axis=0) <= bed+.001), plate
        report["plates"].append({"file": plate["file"], "fits_printer": True,
                                 "sha256": hashlib.sha256((OUT / "plates" / plate["file"]).read_bytes()).hexdigest(),
                                 "bounds": [vertices.min(0).tolist(), vertices.max(0).tolist()]})
    assembly = import_step(OUT / "assembly/camx-pro.step")
    assert assembly.is_valid
    assert len(assembly.solids()) >= len(manifest["parts"])-1
    (OUT / "reports/artifacts.json").write_text(json.dumps(report, indent=2)+"\n")
    print(f"{len(report['parts'])} watertight printable parts; "
          f"{len(report['plates'])} plates fit A1 mini; STEP round-trips passed.")


if __name__ == "__main__":
    main()
