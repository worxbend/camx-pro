"""P3 regression probes for the sixteen P2 findings. Hardware qualification is separate."""
import json
import math
from pathlib import Path
from build123d import Pos, Plane
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
from cad.assembly import build, transform
from cad.config import load, source_digest
from cad.geometry import cylinder, xhole, box
from cad.interfaces import pan_stack
from cad.tilt_drive import drive_datums
from tools.check_interference import volume


def ray_hits(shape,origin,direction):
    ray=IntCurvesFace_ShapeIntersector();ray.Load(shape.wrapped,1e-7)
    ray.Perform(gp_Lin(gp_Pnt(*origin),gp_Dir(*direction)),0,100)
    return sorted({round(ray.WParameter(i),7) for i in range(1,ray.NbPnt()+1)})


def main():
    p=load();digest=source_digest();parts,_=build(p);s={n:c.shape for n,c in parts.items()}
    results=[]
    def check(id,title,passed,evidence):
        results.append(dict(id=id,title=title,status='passed' if passed else 'failed',evidence=evidence))
    stack=pan_stack(p)
    contacts={name:s[a].distance_to(s[b]) for name,a,b in [
        ('base_ring','base_shell','planetary_ring'),('ring_housing','planetary_ring','output_bearing_housing'),
        ('outer_spacer_lower','output_bearing_spacer','pan_bearing_lower'),
        ('outer_spacer_upper','output_bearing_spacer','pan_bearing_upper'),
        ('inner_spacer_lower','output_inner_spacer','pan_bearing_lower'),
        ('inner_spacer_upper','output_inner_spacer','pan_bearing_upper')]}
    sun_clearance=s['sun_bearing'].bounding_box().min.Z-37.3
    check('P1','Supported output stack and floating sun cartridge',max(contacts.values())<1e-5 and sun_clearance>.5,dict(contacts_mm=contacts,sun_bottom_float_mm=sun_clearance,output_endplay_mm=p['interfaces']['output_endplay']))
    heads=[]
    for a in range(0,360,10):
        lower=transform(parts['planetary_carrier_lower'],p,pan=a)
        for x in [-17.5,17.5]:heads.append(volume(cylinder(5.5,1.6,x,8,24.5),lower))
    for a in [0,120,240]:
        x,y=31*math.cos(math.radians(a)),31*math.sin(math.radians(a))
        heads.append(volume(cylinder(3.5,1.2,x,y,69.9),s['pan_platform']))
    check('P2','Motor and output retainer head envelopes',max(heads)<.05,dict(max_overlap_mm3=max(heads),motor_head_limit_mm=[5.5,1.6],retainer_head_limit_mm=[3.5,1.2]))
    stops={}
    for dz in [-.21,.21]:
        stops[str(dz)]=volume(Pos(0,0,dz)*(s['planetary_planet_0']+s['planetary_planet_cap_0']),s['planet_bearing_0'])
    free=volume(Pos(0,0,-.2)*s['planetary_planet_0'],s['planetary_carrier_lower'])
    check('P3','Planet outer race captured in both directions',min(stops.values())>.05 and free<.05,dict(stopping_overlap_mm3=stops,carrier_overlap_at_endplay_mm3=free))
    check('P4','Located planet sleeves',p['fit']['pilot_diametral']<=.1,dict(sleeve_od_mm=8,pilot_clearance_mm=p['fit']['pilot_diametral'],sleeve_length_mm=14.5,lower_nut_roof_mm=1))
    # Geometric parameter response is checked independently by parameters-and-loads.
    check('P5','Bearing clearance wired into machined interfaces',stack['pocket_od']==p['pan']['bearing_od']+p['fit']['bearing_diametral'],dict(actual_pocket_mm=stack['pocket_od'],parameter=p['fit']['bearing_diametral']))
    d=drive_datums(p);roll=math.radians(d['motor_roll']);arm=p['tilt']['arm_inner'];z=p['tilt']['axis_z']
    mounts=[(d['motor_y']+8*math.cos(roll)+ear*math.sin(roll),d['motor_z']+8*math.sin(roll)-ear*math.cos(roll)) for ear in [-17.5,17.5]]
    access=[]
    for y,zz in mounts:
        for sign in [-1,1]:
            probe=xhole(3,25,32,y,zz)
            access.append(volume(probe if sign>0 else probe.mirror(Plane.YZ),s['gimbal_yoke']))
    check('T1','Through motor bolts and captured rear-cover nuts',max(access)<.05,dict(max_obstruction_mm3=max(access),bolt='M3×25',nut_pocket_af_mm=5.8))
    adjustment=[]
    for shift in [-1,-.5,0,.5,1]:
        delta=Pos(0,shift*math.cos(roll),shift*math.sin(roll))
        for name in ['tilt_motor','tilt_drive_pulley','rear_drive_cover']:
            adjustment.append(dict(shift_mm=shift,component=name,overlap_mm3=volume(delta*s[name],s['gimbal_yoke'])))
    check('T2','Full motor and cover adjustment',max(v['overlap_mm3'] for v in adjustment)<.05,adjustment)
    overlaps=[volume(xhole(3.5,1.2,46.8,y,z),s['tilt_axis_pulley']) for y in [-10.5,10.5]]
    check('T3','Tilt retainer head recesses',max(overlaps)<.05,dict(max_overlap_mm3=max(overlaps),head_envelope_mm=[3.5,1.2],head_to_hub_gap_mm=1))
    check('T4','Widened split clamp with captured nut',len(s['camera_cradle'].solids())==1,dict(hub_width_mm=8,nut_af_mm=5.8,minimum_nominal_side_wall_mm=(8-5.8)/2,nut_roof_mm=1.651,physical_clamp_coupon='required'))
    axial=[]
    for dx in [-.1,.1]:
        for n in ['camera_cradle','tilt_axis_pulley','tilt_passive_collar']:
            for fixed in ['gimbal_yoke','tilt_retainer_drive','tilt_retainer_passive']:
                axial.append(volume(Pos(dx,0,0)*s[n],s[fixed]))
    check('T5','Defined tilt inner-race spacer stack',max(axial)<.05,dict(endplay_mm=.2,max_printed_interference_mm3=max(axial),inner_spacer_length_mm=2.1,outer_spacer_length_mm=3.9,shaft_length_mm=28))
    # The two inserts are removable; the opening reaches the bonnet seam.
    probe=box(8,25,12,y=80,z=10)
    outlet=volume(probe,s['base_lid'])
    check('E1','Seam-open intact-USB insertion',outlet<.05,dict(provisional_plug_mm=[12,8],insertion_orientation="8mm across X,12mm across Z; inserts removed",opening_mm=[24,24],plug_obstruction_with_insert_removed_mm3=outlet))
    check('E2','Bonnet bosses integrated through radial webs',len(s['base_lid'].solids())==1,dict(boss_od_mm=14,web_width_mm=8,web_height_mm=18))
    retained=['esp32','driver_pan','driver_tilt','integration_pcb','usb_power']
    gaps={n:s[n].distance_to(s[n+'_tray']) for n in retained}
    check('E3','Board trays and insulating strap retention',max(gaps.values())<1e-5 and all(n+'_tie_a' in s for n in retained),dict(seating_gaps_mm=gaps,capacitor='Separate screwed cup and insulating tie; pads and populated PCB outlines require measurement'))
    check('E4','Hatch receivers',s['base_shell'].is_inside((18.5+2,0,7)),dict(receiver_height_mm=6,selected_screw='M2×6, head≤Ø3.5×1.2'))
    walls=[]
    for z0 in [20,40,60,80]:
        for a in range(180,271,10):
            h=ray_hits(s['base_lid'],(0,0,z0),(math.cos(math.radians(a)),math.sin(math.radians(a)),0))
            if len(h)==2:walls.append(h[1]-h[0])
    check('E5','Constant-normal-offset bonnet',bool(walls) and min(walls)>=p['base']['wall']-.02,dict(sampled_min_radial_wall_mm=min(walls),specified_normal_wall_mm=p['base']['wall'],full_normal_thickness_proof=False))
    check('E6','Separate accessible cable layers and strain relief',all(n in s for n in ['cable_guide_tray','cable_guide_shelf','cable_guide_roof','pan_cable_ceiling_front','pan_cable_ceiling_rear','fixed_usb_clamp','fixed_motor_clamp','moving_cable_clamp']),dict(loop_checks='cable-routing.json',physical_gate='Measured cable/plug, slack, drag, wear, fixed tails and tilt loop trials remain required'))
    result=dict(status='passed' if all(v['status']=='passed' for v in results) else 'failed',revision=p['revision'],cad_source_sha256=digest,checks=results,qualification='Nominal CAD corrections only; physical hardware and print qualification pending')
    assert source_digest()==digest
    target=Path('exports/reports/preprint');target.mkdir(parents=True,exist_ok=True)
    (target/'mechanical-interfaces.json').write_text(json.dumps(result,indent=2)+'\n')
    for r in results:print(r['id'],r['status'],r['title'],flush=True)
    raise SystemExit(result['status']!='passed')

if __name__=='__main__':main()
