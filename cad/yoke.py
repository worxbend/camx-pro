"""Bearing-supported U-yoke, removable camera cradle and shoulder drive."""
import math
from build123d import Pos, Rot, Plane
from .geometry import box, cylinder, ring, rounded, along_x, xhole, flat_shaft
from .interfaces import pan_stack, hex_prism
from .cables import moving_floor, moving_ceiling


def build_yoke(p):
    pan,t,c=p["pan"],p["tilt"],p["camera"]
    z0=pan["platform_z"]
    top=z0+pan["platform_thickness"]
    axis=t["axis_z"]
    inner=t["arm_inner"]
    thick=t["arm_thickness"]
    # The platform fastens to the independent planetary carrier journal.
    platform=cylinder(pan['platform_diameter'],pan['platform_thickness'],z=z0)
    stack=pan_stack(p)
    shoulder=stack["upper_inner_shoulder"]
    platform+=ring(p["interfaces"]["output_inner_land_od"],pan["bearing_id"]+.15,1,z=shoulder)
    platform+=ring(pan["bearing_id"]+5,pan["bearing_id"]+.15,z0-shoulder-1,z=shoulder+1)
    platform+=moving_floor()
    platform-=cylinder(pan['cable_bore'],20,z=z0-10)
    for a in [0,90,180,270]:
        x,y=20.2*math.cos(math.radians(a)),20.2*math.sin(math.radians(a))
        platform-=cylinder(2.3,10,x,y,z0-4)
        platform-=cylinder(4.2,1.5,x,y,top-1.4)
    for a in [0,120,240]:
        platform-=Rot(0,0,a)*Pos(44,0,z0+2.5)*Rot(0,90,0)*cylinder(1.8,6)
    platform-=rounded(16,20,9,2,x=-50,y=1,z=z0-1)
    for a in [45,135,225,315]:
        x,y=30*math.cos(math.radians(a)),30*math.sin(math.radians(a))
        platform-=cylinder(2.3,8,x,y,z0-1)
        platform-=cylinder(4.2,1.5,x,y,top-1.4)
    # Four underside screws secure the continuous U-frame above the platform.
    for x in [-28,28]:
        for y in [-8,8]:
            platform -= cylinder(3.4,8,x,y,z0-1)
            platform -= cylinder(6.2,1.8,x,y,z0-.1)
    from .gimbal import build_gimbal
    gimbal, drive = build_gimbal(p)
    # Shelf and curved side cheeks leave the original webcam face exposed.
    shelf=axis-c["height"]/2-4
    opening=c["width"]+2*p["fit"]["camera_side"]
    cradle=rounded(opening+2*t["cradle_wall"],c["depth"]+.5,4,5,y=-1.25,z=shelf)
    for sign in [-1,1]:
        cx=sign*(opening/2+t["cradle_wall"]/2)
        cheek=box(t["cradle_wall"],24,axis-shelf,cx,0,shelf)
        cheek+=xhole(24,t["cradle_wall"],cx-t["cradle_wall"]/2,0,axis)
        cradle+=cheek
        # 8 mm steel stub shafts fit blind-to-camera sockets; M3 clamp screws.
        hub_start = opening/2+t["cradle_wall"]
        hub_center = hub_start+4
        hub=xhole(20,8,hub_start,0,axis)+box(8,20,9,hub_center,0,axis+4)
        if sign < 0:
            hub=hub.mirror(Plane.YZ)
        cradle+=hub
        cradle-=xhole(8+p["fit"]["shaft_diametral"],24,cx-12,0,axis)
        clamp_x=sign*hub_center
        cradle-=box(18,.8,10,sign*(hub_center-2),0,axis+4)
        cradle-=Pos(clamp_x,-14,axis+8)*Rot(-90,0,0)*cylinder(3.4,28)
        # Captured M3 nut loaded from the rear, with a substantial supporting ear.
        cradle-=Pos(clamp_x,7.3,axis+8)*Rot(-90,0,0)*hex_prism(5.8,3.0)
    # Tripod screw fore/aft slot; verify the actual factory interface/depth.
    cradle-=box(6.8,14,7,z=shelf-1)
    for y in [-7,7]:
        cradle-=cylinder(6.8,7,0,y,shelf-1)
    cradle-=box(13,26,2,z=shelf)
    for x in [-18,18]:
        cradle-=box(3,6,7,x,c["depth"]/2-5.5,shelf-1)
    roof=moving_ceiling()
    return {"pan_platform": platform,
            "pan_cable_ceiling_front":roof & box(160,80,20,y=-40.15,z=80),
            "pan_cable_ceiling_rear":roof & box(160,80,20,y=40.15,z=80),
            "camera_cradle": cradle, **gimbal}, {**drive, "camera_shelf": shelf}
