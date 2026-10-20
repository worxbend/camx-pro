"""Sample ideal constant-length cable tubes against actual guide/assembly meshes.

Not a mechanics solver: cable stiffness, free tails, tilt loop, drag and thermal
behavior still need physical tests. CAD geometry and centerlines share provenance.
"""
import json,math,tempfile
from pathlib import Path
import numpy as np
import trimesh
from scipy.spatial import cKDTree
from build123d import export_stl
from cad.config import load,source_digest
from cad.assembly import build
from cad.cables import specifications,points


def surface_clearance(mesh, pts, radius):
    """Signed cable clearance, including centerlines deep inside a solid."""
    _, dist, _ = trimesh.proximity.closest_point(mesh, pts)
    # Distance to the boundary alone cannot distinguish an open channel from
    # deep penetration. Test every point inside the mesh's bounding box.
    candidates = np.flatnonzero(np.all(
        (pts >= mesh.bounds[0]-1e-8) & (pts <= mesh.bounds[1]+1e-8), axis=1))
    inside = np.zeros(len(pts), dtype=bool)
    if len(candidates):
        inside[candidates] = mesh.contains(pts[candidates])
    return np.where(inside, -dist, dist)-radius, inside


def main():
    p=load();digest=source_digest();parts,_=build(p)
    names=['base_lid','cable_guide_tray','cable_guide_shelf','cable_guide_roof',
           'fixed_usb_clamp','fixed_motor_clamp','pan_platform','pan_cable_ceiling_front',
           'pan_cable_ceiling_rear','gimbal_yoke','moving_cable_clamp','turntable_skirt',
           'output_bearing_retainer','output_bearing_housing']
    specs=specifications();routes={};lengths={};cross=math.inf;self_dist={name:math.inf for name in specs}
    for pan in range(-160,161,5):
        routes[pan]={name:points(c,pan,spacing=.6) for name,c in specs.items()}
        u,m=routes[pan]['usb'],routes[pan]['motor']
        cross=min(cross,float(cKDTree(u).query(m)[0].min())-3.5)
        for name,path in routes[pan].items():
            ss=np.r_[0,np.cumsum(np.linalg.norm(np.diff(path,axis=0),axis=1))]
            lengths.setdefault(name,[]).append(float(ss[-1]))
            pairs=cKDTree(path).query_pairs(10,output_type='ndarray')
            if len(pairs):
                pairs=pairs[np.abs(ss[pairs[:,0]]-ss[pairs[:,1]])>15]
                if len(pairs):self_dist[name]=min(self_dist[name],float(np.linalg.norm(path[pairs[:,0]]-path[pairs[:,1]],axis=1).min())-specs[name]['diam'])
    records=[]
    with tempfile.TemporaryDirectory(prefix='camx-cable-') as tmp:
        for name in names:
            c=parts[name];file=Path(tmp)/(name+'.stl')
            export_stl(c.shape,file,tolerance=.02,angular_tolerance=.08)
            mesh=trimesh.load_mesh(file,process=True)
            assert mesh.is_watertight and mesh.is_winding_consistent, name
            for cable,spec in specs.items():
                worst=(math.inf,None);inside_count=0
                for pan,paths in routes.items():
                    pts=paths[cable]
                    if c.group=='pan':
                        a=math.radians(-pan);mat=np.array([[math.cos(a),-math.sin(a),0],[math.sin(a),math.cos(a),0],[0,0,1]])
                        pts=pts@mat.T
                    clear,inside=surface_clearance(mesh,pts,spec['diam']/2)
                    i=int(np.argmin(clear))
                    if clear[i]<worst[0]:worst=(float(clear[i]),dict(pan=pan,point_mm=pts[i].tolist()))
                    inside_count+=int(inside.sum())
                row=dict(part=name,cable=cable,minimum_sampled_surface_clearance_mm=worst[0],pose=worst[1],inside_centerline_samples=inside_count)
                records.append(row);print(name,cable,round(worst[0],4),flush=True)
    failed=[v for v in records if v['minimum_sampled_surface_clearance_mm']<-.03 or v['inside_centerline_samples']]
    result=dict(status='failed' if failed or cross<0 or min(self_dist.values())<0 else 'passed',cad_source_sha256=digest,pan_step_degrees=5,centerline_spacing_mm=.6,mesh_tolerance_mm=.02,records=records,failures=failed,cross_cable_clearance_mm=cross,self_clearance_mm=self_dist,length_variation_mm={n:max(v)-min(v) for n,v in lengths.items()},limitations=['Ideal prescribed paths; no flexible-body or friction simulation.','Finite samples; not continuous proof.','Stationary tails after clamps and the camera tilt service loop remain unqualified.','Provisional cable diameters and bend radii; test actual cables manually before powering motors.'])
    assert digest==source_digest()
    out=Path('exports/reports/preprint');out.mkdir(parents=True,exist_ok=True)
    (out/'cable-routing.json').write_text(json.dumps(result,indent=2)+'\n')
    raise SystemExit(result['status']!='passed')

if __name__=='__main__':main()
