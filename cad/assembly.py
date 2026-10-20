"""Named assembly and kinematics shared by exporters and the browser viewer."""
from dataclasses import dataclass
from build123d import Pos, Rot, Color, Compound
from .base import build_base
from .yoke import build_yoke
from .config import load, pan_motor_offset, pan_ratio
from .geometry import box, ring, cylinder, along_x, rounded
from .planetary import planet_centers, planet_phase
from .electronics import build_trays
from .interfaces import pan_stack, hex_prism
from .tilt_drive import motor_location, pulley, belt_envelope, drive_datums
from .hardware import motor, motor_shaft, camera, camera_front, camera_lens, board


@dataclass
class Component:
    name: str
    shape: object
    group: str = "fixed"
    printed: bool = True
    color: str = "#242b31"
    print_rotation: tuple = (0, 0, 0)
    note: str = "PLA; provisional fits; inspect slicer before printing."


def build(p=None):
    p = p or load()
    components = {}
    base = build_base(p)
    yoke, datums = build_yoke(p)
    for name, shape in {**base, **yoke}.items():
        group = "pan" if name in yoke or name in ["planetary_carrier_lower","planetary_carrier_upper","sun_bearing_cartridge","sun_bearing_retainer"] else "fixed"
        if name in ["camera_cradle"]:
            group="tilt"
        if name in ['planetary_sun','sun_journal_cap']:
            group='pinion'
        if name.startswith('planetary_planet_'):
            group='planet_'+name.rsplit('_',1)[1]
        rotation=(0,0,0)
        if name in ["yoke_cover_drive", "tilt_retainer_drive", "rear_drive_cover"]:
            rotation=(0,-90,0)
        if name in ["yoke_cover_passive", "tilt_retainer_passive"]:
            rotation=(0,90,0)
        if name in ['pan_platform','output_bearing_housing']:
            rotation=(180,0,0)
        if name.startswith("cable_exit_"):
            rotation=(90,0,0)
        if name.endswith("_clamp"):
            rotation=(0,90,0)
        if name.startswith("planetary_planet_cap_"):
            rotation=(180,0,0)
        components[name]=Component(name,shape,group,True,
            "#3d454b" if "gear" in name or "pinion" in name else "#242b31",rotation)
    pan,t=p["pan"],p["tilt"]
    axis=t["axis_z"]
    motor_z=pan["motor_z"]
    hardware={
        "pan_motor":(Pos(0,pan_motor_offset(p),motor_z)*motor(p),"fixed","#a9adb1"),
        "tilt_motor":(motor_location(p)*motor(p),"pan","#a9adb1"),
        "pan_motor_shaft":(Pos(0,pan_motor_offset(p),motor_z)*motor_shaft(p),"pinion","#b5bec6"),
        "tilt_motor_shaft":(motor_location(p)*motor_shaft(p),"tilt_drive","#b5bec6"),
        "tilt_drive_pulley":(pulley(p),"tilt_drive","#737a80"),
        "tilt_axis_pulley":(pulley(p,True),"tilt","#737a80"),
        "tilt_belt":(belt_envelope(p),"pan","#101519"),
        "pan_bearing_lower":(ring(pan["bearing_od"],pan["bearing_id"],pan["bearing_width"],z=pan["bearing_z"]),"fixed","#b5bec6"),
        "pan_bearing_upper":(ring(pan["bearing_od"],pan["bearing_id"],pan["bearing_width"],z=pan["bearing_z"]+pan["bearing_spacing"]),"fixed","#b5bec6"),
        "sun_bearing":(ring(16,8,5,z=38),"pan","#b5bec6"),
        "tilt_bearing_drive":(along_x(ring(t["bearing_od"],t["bearing_id"],t["bearing_width"]),t["arm_inner"]+1,0,axis),"pan","#b5bec6"),
        "tilt_bearing_passive":(along_x(ring(t["bearing_od"],t["bearing_id"],t["bearing_width"]),-t["arm_inner"]-6,0,axis),"pan","#b5bec6"),
        "tilt_shaft_drive":(along_x(cylinder(8,28),27,0,axis),"tilt","#b5bec6"),
        "tilt_shaft_passive":(along_x(cylinder(8,28),-55,0,axis),"tilt","#b5bec6"),
        "camera":(camera(p),"tilt","#151b21"),
        "camera_front":(camera_front(p),"tilt","#090f14"),
        "camera_lens":(camera_lens(p),"tilt","#234a5c"),
        "esp32":(board(p["electronics"]["esp32"],-55,-12,7),"fixed","#153e31"),
        "driver_pan":(board(p["electronics"]["driver"],55,-24,7),"fixed","#286548"),
        "driver_tilt":(board(p["electronics"]["driver"],55,24,7),"fixed","#286548"),
        "integration_pcb":(box(*p["electronics"]["integration"],0,-40,7),"fixed","#286548"),
        "usb_power":(board(p["electronics"]["usb_board"],36,66,27)+box(9,11,3.2,36,76.5,28),"fixed","#c5c9ca"),
        "capacitor":(cylinder(p["electronics"]["capacitor"][0],p["electronics"]["capacitor"][1],29,-59,7),"fixed","#2e343f"),
        "camera_plug":(box(12,p["camera"]["plug_depth"],8,0,p["camera"]["depth"]/2+p["camera"]["plug_depth"]/2,axis-10),"tilt","#252a31")
    }
    for i,(x,y) in enumerate(planet_centers(p)):
        hardware[f'planet_bearing_{i}']=(ring(16,8,5,x,y,30),'pan','#b5bec6')
        hardware[f'planet_pin_{i}']=(ring(8,3.2,14.5,x,y,28.5),'pan','#b5bec6')
        hardware[f'planet_shim_lower_{i}']=(ring(11,8.2,.2,x,y,29.8),'pan','#b5bec6')
        hardware[f'planet_shim_upper_{i}']=(ring(11,8.2,6.7,x,y,35),'pan','#b5bec6')
    # Defined inner-race spacers and passive shaft collar provide the axial load path.
    hardware['output_inner_spacer']=(ring(48,45.15,5,z=56),'pan','#b5bec6')
    for sign,label in [(1,'drive'),(-1,'passive')]:
        inner=along_x(ring(11,8.15,2.1),37.9,0,axis)
        outer=along_x(ring(11,8.15,3.9),45,0,axis)
        from build123d import Plane
        if sign<0:
            inner=inner.mirror(Plane.YZ);outer=outer.mirror(Plane.YZ)
        hardware['tilt_inner_spacer_'+label]=(inner,'tilt','#b5bec6')
        hardware['tilt_outer_spacer_'+label]=(outer,'tilt','#b5bec6')
    hardware['tilt_passive_collar']=(along_x(ring(16,8.15,5),-54,0,axis),'tilt','#737a80')
    _,_,ties=build_trays(p,base['base_shell'])
    for name,shape in ties.items():
        hardware[name]=(shape,'fixed','#686970')
    for name,(shape,group,color) in hardware.items():
        components[name]=Component(name,shape,group,False,color,note="Non-print reference; measure actual hardware.")
    for name in components:
        if name.startswith('planetary_planet_'):
            components[name].color='#60756b'
        elif name in ['planetary_sun','sun_journal_cap']:
            components[name].color='#a0aaa1'
    # First coupon checks fits without committing to full-size prints.
    coupon=rounded(150,75,3,5)
    for x,diameter in [(-40,58), (64,16)]:
        coupon+=ring(diameter+5,diameter+p['fit']['bearing_diametral'],5,x,0,3)
    coupon+=cylinder(pan_stack(p)["journal_od"],5,25,0,3)
    coupon+=ring(10,5.2,5,-4,-24,3)
    for x in [-60,-36,-12,12,36,60]:
        coupon-=cylinder(2.6+(x+60)/120*.8,5,x,-34.5,-1)
    components["fit_coupon"]=Component("fit_coupon",coupon,"coupon",True,"#8b9d87")
    return components, {
        **datums,"pan_axis":[0,0,0],"tilt_axis":[0,0,axis],
        "planet_centers":[list(c) for c in planet_centers(p)],
        "planet_relative_ratio":-(pan["sun_teeth"]/pan["planet_teeth"])*(pan_ratio(p)-1),
        "pan_ratio":pan_ratio(p),"pan_motor_axis":[0,pan_motor_offset(p),0],
        "limits":{"pan":[pan["minimum"],pan["maximum"]],"tilt":[t["minimum"],t["maximum"]]},
        "physical_validation":"pending","hardware_dimensions":"provisional"
    }


def transform(component,p,pan=0,tilt=0):
    if component.group=="tilt":
        z=p["tilt"]["axis_z"]
        return Rot(0,0,pan)*Pos(0,0,z)*Rot(-tilt,0,0)*Pos(0,0,-z)*component.shape
    if component.group=="tilt_drive":
        d=drive_datums(p)
        return Rot(0,0,pan)*Pos(0,d["motor_y"],d["motor_z"])*Rot(-tilt*d["tilt_ratio"],0,0)*Pos(0,-d["motor_y"],-d["motor_z"])*component.shape
    if component.group=="pan":
        return Rot(0,0,pan)*component.shape
    if component.group.startswith('planet_'):
        i=int(component.group.rsplit('_',1)[1])
        x,y=planet_centers(p)[i]
        ratio=-(p['pan']['sun_teeth']/p['pan']['planet_teeth'])*(pan_ratio(p)-1)
        return Rot(0,0,pan)*Pos(x,y,0)*Rot(0,0,ratio*pan)*Pos(-x,-y,0)*component.shape
    if component.group=="pinion":
        y=pan_motor_offset(p)
        return Pos(0,y,0)*Rot(0,0,pan*pan_ratio(p))*Pos(0,-y,0)*component.shape
    return component.shape


def print_pose(component):
    shape=Rot(*component.print_rotation)*component.shape
    bb=shape.bounding_box()
    return Pos(-bb.center().X,-bb.center().Y,-bb.min.Z)*shape


def compound(components,p,pan=0,tilt=0):
    children=[]
    for item in components.values():
        if item.group=="coupon":
            continue
        shape=transform(item,p,pan,tilt)
        shape.label=item.name
        shape.color=Color(item.color)
        children.append(shape)
    return Compound(children=children,label="CAMX_Pro")
