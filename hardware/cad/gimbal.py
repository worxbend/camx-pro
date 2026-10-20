"""Continuous U-frame with recessed side covers and a concealed timing drive."""
import math
from build123d import Axis, Plane, Pos, Rot, RectangleRounded, Circle, Wire, Face, Rectangle, extrude
from .geometry import box, cylinder, ring, rounded, xhole
from .tilt_drive import drive_datums, motor_location, yz_profile, yz_extrusion
from .interfaces import bearing_pocket, hex_prism, slot_x


def build_gimbal(p):
    t, pan = p['tilt'], p['pan']
    d = drive_datums(p)
    z = t['axis_z']
    arm=t['arm_inner']
    travel=p['interfaces']['motor_adjustment']
    bottom = pan['platform_z']+pan['platform_thickness']+.3
    top = z+19
    angle = math.radians(d['motor_roll'])
    mounts = [(d['motor_y']+8*math.cos(angle)+ear*math.sin(angle),
               d['motor_z']+8*math.sin(angle)-ear*math.cos(angle))
              for ear in [-p['motor']['ear_pitch']/2,p['motor']['ear_pitch']/2]]
    outline = Pos(0,0,(top+bottom)/2)*(Plane.XZ*RectangleRounded(2*(arm+23),top-bottom,20))
    opening = Pos(0,0,top)*(Plane.XZ*RectangleRounded(2*arm,150,12))
    frame = Pos(0,19,0)*extrude(outline-opening,amount=38)
    frame = frame.fillet(2,frame.edges().filter_by_position(Axis.Y,-19,-19))
    frame += cylinder(2*(arm+24),4,z=bottom) & box(2*(arm+23),130,4,z=bottom)
    centers = [(0,z),(0,bottom+19),(d['motor_y'],d['motor_z']),*mounts]
    wing_profile = yz_profile(centers,[19,19,16,7,7])
    wing = yz_extrusion(wing_profile,arm,23)
    frame += wing
    frame += wing.mirror(Plane.YZ)
    pocket = yz_extrusion(yz_profile([(0,z),(d['motor_y'],d['motor_z'])],[17.5,12.5]),arm+6,20)
    frame -= pocket
    frame -= pocket.mirror(Plane.YZ)
    for sign in [-1,1]:
        frame -= xhole(p["interfaces"]["tilt_outer_land_id"],8,arm-1 if sign>0 else -arm-7,0,z)
        frame -= xhole(bearing_pocket(p,t["bearing_od"]),t["bearing_width"],arm+1 if sign>0 else -arm-1-t["bearing_width"],0,z)
    # The body clears the frame, while the front web supports both motor ears.
    frame -= motor_location(p)*rounded(47,44,20.05,10,y=8,z=-.05)
    frame -= xhole(7,8,arm,d['motor_y'],d['motor_z'])
    for y,zz in mounts:
        for sign in [-1,1]:
            slot=slot_x(3.4,25,arm-1,y,zz,travel,d['motor_roll'])
            head=slot_x(6.4,7,arm+18,y,zz,travel,d['motor_roll'])
            frame-=slot if sign>0 else slot.mirror(Plane.YZ)
            frame-=head if sign>0 else head.mirror(Plane.YZ)
    for x in [-28,28]:
        for y in [-8,8]:
            frame -= cylinder(2.6,6,x,y,bottom-.1)
    # Access to the platform-to-output screws after the yoke is assembled.
    for a in [0,90,180,270]:
        frame-=cylinder(4.5,12,20.2*math.cos(math.radians(a)),20.2*math.sin(math.radians(a)),bottom-1)
    for a in [45,135,225,315]:
        frame-=cylinder(4.5,12,30*math.cos(math.radians(a)),30*math.sin(math.radians(a)),bottom-1)
    # Protected harness route in the passive arm, outside the planetary stage.
    frame -= rounded(14,20,z-8-bottom,2,x=-50,y=3,z=bottom-1)
    frame -= xhole(20,12,-arm-7,16,z-19)
    retainers = {}
    for sign in [-1,1]:
        part = xhole(28,3.2,arm+6,0,z)-xhole(p["interfaces"]["tilt_outer_land_id"],5,arm+5,0,z)
        for y in [-10.5,10.5]:
            part -= xhole(2.3,5,arm+5,y,z)
            part -= xhole(4.2,1.5,arm+7.8,y,z)
            frame -= xhole(1.8,6,arm if sign>0 else -arm-6,y,z)
        retainers['tilt_retainer_drive' if sign>0 else 'tilt_retainer_passive'] = part if sign>0 else part.mirror(Plane.YZ)
    cap = yz_extrusion(wing_profile,arm+23.3,2.4)
    cap = cap.fillet(.8,cap.edges().filter_by_position(Axis.X,arm+25.699,arm+25.701))
    for y,zz in [(d['motor_y']+9,d['motor_z']-12),(-14,z-14)]:
        boss = xhole(5,23,arm,y,zz)
        frame += boss
        frame += boss.mirror(Plane.YZ)
        for sign in [-1,1]:
            frame -= xhole(1.8,8,arm+16 if sign>0 else -arm-24,y,zz)
        cap -= xhole(2.3,5,arm+22,y,zz)
        cap -= xhole(4.2,1,arm+25,y,zz)
    frame -= motor_location(p)*rounded(47,44,20.05,10,y=8,z=-.05)
    frame -= slot_x(12.8,17,arm+.1,d['motor_y'],d['motor_z'],travel,d['motor_roll'])
    # Motor cover: a shaped bridge across the rear with two screw lugs per end.
    edges=[]
    for center,radius in [((0,8),16.2),((-17.5,8),5.5),((17.5,8),5.5)]:
        edges.extend((Pos(*center)*Circle(radius)).edges())
    edges.extend((Pos(0,22)*Rectangle(21,12)).edges())
    profile=Face(Wire.make_convex_hull(edges,tolerance=1e-4))
    orientation=Rot(d['motor_roll'],0,0)*Rot(0,90,0)
    rear=Pos(-arm,d['motor_y'],d['motor_z'])*orientation*extrude(profile,amount=2*arm,dir=(0,0,1))
    inner_edges=[]
    for center,radius in [((0,8),14.6),((-17.5,8),4.2),((17.5,8),4.2)]:
        inner_edges.extend((Pos(*center)*Circle(radius)).edges())
    inner_edges.extend((Pos(0,22)*Rectangle(17,8)).edges())
    inside=Face(Wire.make_convex_hull(inner_edges,tolerance=1e-4))
    rear-=Pos(-arm+2,d['motor_y'],d['motor_z'])*orientation*extrude(inside,amount=2*arm,dir=(0,0,1))
    cover_clearance=Pos(-arm-.2,d['motor_y'],d['motor_z'])*orientation*extrude(profile.scale(1.02),amount=2*arm+.4,dir=(0,0,1))
    for shift in [-travel-.2,0,travel+.2]:
        frame-=Pos(0,shift*math.cos(angle),shift*math.sin(angle))*cover_clearance
    for shift in [-travel,travel]:
        frame-=Pos(0,shift*math.cos(angle),shift*math.sin(angle))*motor_location(p)*rounded(47,44,20.05,10,y=8,z=-.05)
    rear-=box(180,180,60,z=-5)
    # Rear cover screws use the same two robust ear regions on the passive side;
    # on the drive side choose offset points clear of the actual ear fasteners.
    for y,zz in mounts:
        for sign in [-1,1]:
            x=arm-7 if sign>0 else -arm
            rear += xhole(11,6.5 if sign>0 else 7,x,y,zz)
            rear -= xhole(3.4,10,arm-8 if sign>0 else -arm-1,y,zz)
            nut=Pos(arm-7,y,zz)*Rot(0,90,0)*hex_prism(5.8,2.7)
            rear-=nut if sign>0 else nut.mirror(Plane.YZ)
    rear -= motor_location(p)*cylinder(p['motor']['diameter']+.6,p['motor']['depth']+.4,y=8,z=-.2)
    # Central USB service channel clears the provisional plug throughout tilt.
    # The lower rear bridge remains continuous; flexible cable still needs trials.
    rear -= rounded(22,70,70,3,y=35,z=t['axis_z']-50)
    # The cover lugs share the motor ear bolts on the drive side. On the passive
    # side use separate through M3 bolts; their heads are reached under the cap.
    # Continuous conservative shelf envelope; includes clearance while the
    # cover follows the motor's ±1 mm tension adjustment. Actual rear shelf is
    # trimmed 2.5 mm so the motor itself also clears at inward adjustment.
    camera=p['camera']
    radius=math.hypot((camera['depth']+3)/2,camera['height']/2+4)+.5
    width=camera['width']+2*p['fit']['camera_side']+2*t['cradle_wall']
    rear-=xhole(2*radius,width+2,-width/2-1,0,t['axis_z'])
    # Pulley set-screw service bore; align the hub screw with this bore before tightening.
    frame-=Pos(arm+4,-45,d['motor_z'])*Rot(-90,0,0)*cylinder(4.5,100)
    skirt=ring(2*(arm+24),99.2,5,z=pan['platform_z'])
    skirt-=rounded(16,20,8,2,x=-50,y=1,z=pan['platform_z']-1)
    for a in [0,120,240]:
        skirt -= Rot(0,0,a)*Pos(49,0,pan['platform_z']+2.5)*Rot(0,90,0)*cylinder(2.3,16)
        skirt -= Rot(0,0,a)*Pos(61,0,pan['platform_z']+2.5)*Rot(0,90,0)*cylinder(4.2,3)
    # Remove the isolated rear sliver left behind the full-width motor recess.
    frame-=box(90,24,4.2,y=63,z=bottom-.1)
    # Split moving strain relief inside the passive conduit; liner supplies grip.
    anchor_z=105
    anchor=box(8.9,20,8,-45.45,3,anchor_z)
    cap_anchor=rounded(6.5,19.6,8,1.8,-53.45,3,anchor_z)
    for y,diam in [(0,p['camera']['cable_diameter']+.4),(6,3.4)]:
        anchor-=cylinder(diam,10,-50,y,anchor_z-1)
        cap_anchor-=cylinder(diam,10,-50,y,anchor_z-1)
    for y in [-4.5,10.5]:
        anchor-=xhole(1.8,9,-50,y,anchor_z+4)
        cap_anchor-=xhole(2.3,8,-57,y,anchor_z+4)
        frame-=xhole(4.2,6,-62,y,anchor_z+4)
    frame+=anchor
    return {'gimbal_yoke':frame,'moving_cable_clamp':cap_anchor,'turntable_skirt':skirt,
            'yoke_cover_drive':cap,'yoke_cover_passive':cap.mirror(Plane.YZ),
            'rear_drive_cover':rear,**retainers},d
