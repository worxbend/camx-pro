"""Rebuild prototype manufacturing artifacts: python -m cad.export [--preview]."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from build123d import Compound, Color, Mesher, Pos, export_gltf, export_step, export_stl
from .assembly import build, compound, print_pose
from .config import ROOT, load, source_digest


def plate_layout(parts,p):
    """Shelf-pack on separate real A1 mini plates; never place parts beyond the bed."""
    margin=p["printer"]["margin"]
    width,depth,_=p["printer"]["bed"]
    plates=[]
    current=[]
    x=y=margin
    row=0
    for component in sorted(parts,key=lambda c:print_pose(c).bounding_box().size.Y,reverse=True):
        shape=print_pose(component)
        b=shape.bounding_box()
        w,d,h=b.size
        if w>width-2*margin or d>depth-2*margin or h>p["printer"]["bed"][2]:
            raise ValueError(f"{component.name} exceeds printer envelope")
        if x+w>width-margin:
            x=margin;y+=row+margin;row=0
        if y+d>depth-margin:
            plates.append(current);current=[];x=y=margin;row=0
        placed=Pos(x-b.min.X,y-b.min.Y,0)*shape
        placed.label=component.name
        current.append((component.name,placed))
        x+=w+margin;row=max(row,d)
    if current:
        plates.append(current)
    return plates


def export(p,out,preview=False):
    components,meta=build(p)
    for name in ["parts","assembly","plates","reports","images","drawings"]:
        (out/name).mkdir(parents=True,exist_ok=True)
    manifest={
        "name":"CAMX Pro","revision":p["revision"],"status":p["status"],"units":"mm",
        "cad_source_sha256":source_digest(),
        "parameters":p,"datums":meta,"parts":{},
        "validation":{"cad_solids":"pending","physical_fit":"pending","torque":"pending",
                      "cable_sweep":"pending","print_trials":"pending"},
        "parameter_sha256":hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest()
    }
    for name,c in components.items():
        b=c.shape.bounding_box()
        entry={"printed":c.printed,"group":c.group,"color":c.color,
               "bounds":[list(b.min),list(b.max)],"note":c.note}
        if c.printed:
            if not c.shape.is_valid or len(c.shape.solids())!=1:
                raise ValueError(f"{name}: invalid/disconnected solid")
            printing=print_pose(c)
            pb=printing.bounding_box()
            entry.update({"print_bounds_mm":list(pb.size),"volume_mm3":c.shape.volume,
                          "print_rotation":c.print_rotation})
            if not preview:
                stem=out/"parts"/name
                export_stl(printing,str(stem.with_suffix(".stl")),tolerance=.08,angular_tolerance=.12)
                export_step(c.shape,stem.with_suffix(".step"))
                mesh=Mesher();mesh.add_shape(printing,linear_deflection=.08,angular_deflection=.12)
                mesh.write(str(stem.with_suffix(".3mf")))
        manifest["parts"][name]=entry
        print(f"Checked {name}",flush=True)
    model=compound(components,p)
    export_gltf(model,out/"assembly/camx-pro.glb",binary=True,linear_deflection=.12,angular_deflection=.15)
    bounds=model.bounding_box()
    manifest["assembly_bounds_mm"]=list(bounds.size)
    if not preview:
        export_step(model,out/"assembly/camx-pro.step")
        reference=Mesher();reference.add_shape(model,linear_deflection=.12,angular_deflection=.15)
        reference.write(str(out/"assembly/reference_DO_NOT_PRINT.3mf"))
        manifest["plates"]=[]
        for i,items in enumerate(plate_layout([c for c in components.values() if c.printed],p),1):
            name=f"a1-mini-plate-{i:02}.3mf"
            mesh=Mesher()
            for part,shape in items:
                mesh.add_shape(shape,linear_deflection=.08,angular_deflection=.12)
            mesh.write(str(out/"plates"/name))
            manifest["plates"].append({"file":name,"parts":[n for n,_ in items]})
    manifest["validation"]["cad_solids"]="passed"
    assert manifest["cad_source_sha256"] == source_digest(), "CAD source changed during export"
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    return components,manifest


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--params",type=Path)
    ap.add_argument("--out",type=Path,default=ROOT/"exports")
    ap.add_argument("--preview",action="store_true")
    args=ap.parse_args()
    export(load(args.params),args.out,args.preview)


if __name__=="__main__":
    main()
