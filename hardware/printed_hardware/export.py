"""Export printed substitutes: python -m printed_hardware.export [--preview]."""
import argparse
import json
from dataclasses import replace
from pathlib import Path
from build123d import Mesher, export_step, export_stl
from cad.assembly import print_pose
from cad.config import ROOT, load as load_p3
from cad.export import plate_layout
from .parts import build, load


def export(out, preview=False):
    p3, h = load_p3(), load()
    parts = build(p3, h)
    for name in ["parts", "plates"]:
        (out / name).mkdir(parents=True, exist_ok=True)
    manifest = {"name": "CAMX Pro printed hardware", "status": h["status"], "units": "mm",
                "clearance": h["clearance"]["print_in_place"], "parts": {}, "plates": []}
    for part in parts:
        shape = part.shape
        if not shape.is_valid or (not part.print_in_place and len(shape.solids()) != 1):
            raise ValueError(f"{part.name}: invalid/disconnected solid")
        printing = print_pose(part)
        manifest["parts"][part.name] = {
            "replaces": part.replaces, "quantity": part.quantity, "material": part.material,
            "print_in_place": part.print_in_place, "print_rotation": part.print_rotation,
            "print_bounds_mm": list(printing.bounding_box().size), "volume_mm3": shape.volume,
            "note": part.note}
        if not preview:
            stem = out / "parts" / part.name
            export_stl(printing, str(stem.with_suffix(".stl")), tolerance=.02,
                       angular_tolerance=.1)
            export_step(shape, stem.with_suffix(".step"))
            mesh = Mesher()
            mesh.add_shape(printing, linear_deflection=.02, angular_deflection=.1)
            mesh.write(str(stem.with_suffix(".3mf")))
        print(f"Checked {part.name}", flush=True)
    if not preview:
        # One plate set per material, each part repeated to its quantity.
        for material in dict.fromkeys(part.material for part in parts):
            copies = [replace(part, name=f"{part.name}_{i + 1}") for part in parts
                      if part.material == material for i in range(part.quantity)]
            slug = material.split()[0].lower()
            for i, items in enumerate(plate_layout(copies, p3), 1):
                name = f"{slug}-plate-{i:02}.3mf"
                mesh = Mesher()
                for _, shape in items:
                    mesh.add_shape(shape, linear_deflection=.02, angular_deflection=.1)
                mesh.write(str(out / "plates" / name))
                manifest["plates"].append({"file": name, "material": material,
                                           "parts": [n for n, _ in items]})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return parts, manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "exports/printed-hardware")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    export(args.out, args.preview)


if __name__ == "__main__":
    main()
