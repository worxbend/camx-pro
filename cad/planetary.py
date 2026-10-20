"""Fixed ring, positively located planet pins and separately retained bearings."""
import math
from build123d import Pos, Rot
from .geometry import box, cylinder, ring, flat_shaft, xhole
from .interfaces import bearing_pocket, hex_prism, pan_stack
from .transmissions import gear


def planet_centers(p):
    g=p["pan"]
    radius=g["module"]*(g["sun_teeth"]+g["planet_teeth"])/2
    return [(radius*math.cos(2*math.pi*i/g["planet_count"]),
             radius*math.sin(2*math.pi*i/g["planet_count"])) for i in range(g["planet_count"])]


def planet_phase(p,index):
    return 360*index/p["pan"]["planet_count"]*(1+p["pan"]["sun_teeth"]/p["pan"]["planet_teeth"])+180/p["pan"]["planet_teeth"]


def gearset(p):
    g=p["pan"]; z=g["gear_z"]; h=g["gear_height"]; m=g["module"]
    sun=Pos(0,0,z-3)*gear(g["sun_teeth"],m,h+3,g["pressure_angle"],g["backlash"]/2)
    sun+=cylinder(8-p["fit"]["journal_diametral"],7,z=z+h)
    sun+=cylinder(10.5,2,z=z+h)
    sun-=Pos(0,0,25)*flat_shaft(p["motor"]["shaft_diameter"],p["motor"]["shaft_flats"],9,.2)
    sun-=box(1.9,4.4,4.4,6.9,0,25.9)
    sun-=xhole(2.3,13,1.1,0,28.1)
    sun-=cylinder(1.8,7,z=39)
    fixed=ring(94,80,10.5,z=26.5)
    fixed+=cylinder(94,h,z=z)-Pos(0,0,z)*Rot(0,0,180/g["ring_teeth"])*gear(
        g["ring_teeth"],m,h,g["pressure_angle"],g["backlash"]/2,True)
    for angle in [45,135,225,315]:
        x,y=43*math.cos(math.radians(angle)),43*math.sin(math.radians(angle))
        fixed-=cylinder(3.4,13,x,y,25.5)
    parts={"planetary_ring":fixed,"planetary_sun":sun}
    for i,(x,y) in enumerate(planet_centers(p)):
        wheel=Pos(0,0,z)*gear(g["planet_teeth"],m,h,g["pressure_angle"],g["backlash"]/2)
        # Collar lies above the teeth and inside the ring's Ø80 opening.
        wheel+=cylinder(28.4,3,z=36)
        wheel-=cylinder(12.5,12,z=28)
        wheel-=cylinder(bearing_pocket(p,p["interfaces"]["planet_bearing_od"]),9.5,z=29.8)
        wheel-=cylinder(18.4,5,z=35.2)
        cap=ring(28.4,12.5,2,z=39)+ring(18,12.5,3.8,z=35.2)
        for angle in [0,90,180,270]:
            x0,y0=11.6*math.cos(math.radians(angle)),11.6*math.sin(math.radians(angle))
            wheel-=cylinder(1.8,5,x0,y0,35)
            # Nuts load from the bore; the 1 mm roof carries the screw tension.
            wheel-=Rot(0,0,angle)*box(4.2,3.4,1.5,9.6,0,36.5)
            wheel-=Rot(0,0,angle)*box(3.4,3.4,1.5,11.6,0,36.5)
            cap-=cylinder(1.8,5,x0,y0,38)
            cap-=cylinder(3.4,1.3,x0,y0,39.8)
        placement=Pos(x,y,0)*Rot(0,0,planet_phase(p,i))
        parts[f"planetary_planet_{i}"]=placement*wheel
        parts[f"planetary_planet_cap_{i}"]=placement*cap
    return parts


def build_actuator(p):
    parts=gearset(p)
    g=p["pan"]; s=pan_stack(p); centers=planet_centers(p)
    lower=ring(70,31,3.5,z=25)
    lower-=ring(46,32,1.8,z=24.9)
    upper=cylinder(70,4,z=s["carrier_bottom"])-cylinder(20+p["fit"]["sliding"],8,z=s["carrier_bottom"]-1)
    upper+=ring(s["journal_od"],36,g["platform_z"]-s["carrier_top"],z=s["carrier_top"])
    upper+=ring(p["interfaces"]["output_inner_land_od"],36,
                s["lower_inner_shoulder"]-s["carrier_top"],z=s["carrier_top"])
    for x,y in centers:
        lower+=ring(11,8+p["fit"]["pilot_diametral"],1.3,x,y,28.5)
        lower-=cylinder(3.4,7,x,y,24)
        lower-=hex_prism(5.8,2.6,x,y,24.9)
        upper+=ring(11,8+p["fit"]["pilot_diametral"],1.3,x,y,s["carrier_bottom"]-1.3)
        upper-=cylinder(3.4,9,x,y,s["carrier_bottom"]-2)
        upper-=cylinder(6.2,2.1,x,y,s["carrier_top"]-2)
    for angle in [0,90,180,270]:
        x,y=20.2*math.cos(math.radians(angle)),20.2*math.sin(math.radians(angle))
        upper-=cylinder(1.8,9,x,y,g["platform_z"]-8)
    # Floating outer race: the separate sun cap locates the inner race on the sun.
    flange=s["carrier_top"]
    cartridge=ring(20,12.5,flange-36.5,z=36.5)+ring(33,12.5,2,z=flange)
    cartridge+=ring(30,12.5,3,z=flange+2)
    cartridge-=cylinder(bearing_pocket(p,16),flange+6-37.3,z=37.3)
    sun_retainer=ring(30,12.5,2,z=flange+5)
    for angle in [135,315]:
        x,y=14.5*math.cos(math.radians(angle)),14.5*math.sin(math.radians(angle))
        cartridge-=cylinder(2.3,8,x,y,flange-1)
        cartridge-=cylinder(4.2,3.2,x,y,flange+2)
        upper-=cylinder(1.8,5,x,y,flange-4)
    for x in [-12,12]:
        cartridge-=cylinder(1.8,7,x,0,flange)
        sun_retainer-=cylinder(2.3,4,x,0,flange+4)
        sun_retainer-=cylinder(4.2,1.4,x,0,flange+5.7)
    sun_cap=ring(10.5,2.3,1.5,z=43)
    land=p["interfaces"]["output_outer_land_id"]
    support=ring(g["bearing_od"]+8,land,s["upper_outer_seat"]-s["housing_bottom"],z=s["housing_bottom"])
    support-=cylinder(s["pocket_od"],s["upper_outer_seat"]-s["lower_outer_seat"]+1,z=s["lower_outer_seat"])
    for angle in [45,135,225,315]:
        x,y=43*math.cos(math.radians(angle)),43*math.sin(math.radians(angle))
        support+=cylinder(8,s["upper_outer_seat"]-37,x,y,37)
        support+=Rot(0,0,angle)*box(18,8,3,x=38,z=s["upper_outer_seat"]-3)
        support-=cylinder(3.4,34,x,y,36)
        support-=cylinder(6.2,2.1,x,y,s["upper_outer_seat"]-2)
    support-=cylinder(80,6,z=37)
    retainer=ring(g["bearing_od"]+8,land,3.2,z=s["upper_outer_seat"])
    for angle in [0,120,240]:
        x,y=31*math.cos(math.radians(angle)),31*math.sin(math.radians(angle))
        retainer-=cylinder(2.3,5,x,y,s["upper_outer_seat"]-1)
        retainer-=cylinder(4.2,1.4,x,y,s["upper_outer_seat"]+1.9)
        support-=cylinder(1.8,8,x,y,s["upper_outer_seat"]-7)
    parts.update(planetary_carrier_lower=lower,planetary_carrier_upper=upper,
                 sun_bearing_cartridge=cartridge,sun_bearing_retainer=sun_retainer,
                 sun_journal_cap=sun_cap,output_bearing_housing=support,
                 output_bearing_retainer=retainer,
                 output_bearing_spacer=ring(g["bearing_od"]-.2,land,s["inner_spacer_height"],
                                           z=g["bearing_z"]+g["bearing_width"]))
    return parts
