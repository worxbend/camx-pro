"""Constant-length rolling-loop geometry in millimetres; cable behavior is unqualified.

Round USB cable and a separate motor harness occupy guided layers. These paths
are ideal geometric centerlines, not a simulation of cable stiffness or friction.
"""
import math
import numpy as np
from build123d import Part, Polygon, extrude, Pos, Plane, Circle, Edge, sweep
from shapely.geometry import LineString
from .geometry import ring, cylinder, box, rounded, xhole


def specifications():
    return {
        'usb':dict(r=29,R=69,b=20,diam=4,z=81,th=math.radians(30.350879006),rot=math.radians(43.181740238),a0=4.9854670748),
        'motor':dict(r=29,R=53,b=12,diam=3,z=75,th=math.radians(69.044668109),rot=math.radians(21.081034044),a0=4.8554670748),
    }


def chunk(c,pan,idx,t):
    p=math.radians(pan);r,R,b=c['r'],c['R'],c['b']
    a=c['a0']+r/(r+R)*p;be=math.radians(170)+p;th=c['th'];t=np.atleast_1d(t)
    if idx==0:
        q=t*a;v=np.c_[R*np.cos(q),R*np.sin(q),np.zeros(len(q))]
    elif idx==1:
        q=t*math.pi;er=np.array([math.cos(a),math.sin(a),0]);et=np.array([-math.sin(a),math.cos(a),0])
        v=(r+b)*er+b*(np.cos(q)[:,None]*er+np.sin(q)[:,None]*et)
    elif idx==2:
        q=a+t*(be-a);v=np.c_[r*np.cos(q),r*np.sin(q),np.zeros(len(q))]
    else:
        if idx==3:
            q=t*th;v=np.c_[r+b*(1-np.cos(q)),-b*np.sin(q),np.zeros(len(q))]
        else:
            q=t*math.pi/2;start=np.array([r+b*(1-math.cos(th)),-b*math.sin(th),0]);direction=np.array([math.sin(th),-math.cos(th),0])
            v=start+b*np.sin(q)[:,None]*direction+np.c_[np.zeros(len(q)),np.zeros(len(q)),b*(1-np.cos(q))]
        mat=np.array([[math.cos(be),-math.sin(be),0],[math.sin(be),math.cos(be),0],[0,0,1]])
        v=v@mat.T
    rot=c['rot'];mat=np.array([[math.cos(rot),-math.sin(rot),0],[math.sin(rot),math.cos(rot),0],[0,0,1]])
    return v@mat.T+np.array([0,0,c['z']])


def fixed_drop(c,t):
    q=np.atleast_1d(t)*math.pi/2;rot=c['rot']
    er=np.array([math.cos(rot),math.sin(rot),0]);et=np.array([-math.sin(rot),math.cos(rot),0])
    return c['R']*er-c['b']*np.sin(q)[:,None]*et+np.c_[np.zeros(len(q)),np.zeros(len(q)),c['z']-c['b']*(1-np.cos(q))]


def points(c,pan=0,spacing=.6):
    a=c['a0']+c['r']/(c['r']+c['R'])*math.radians(pan);be=math.radians(170+pan)
    lengths=[c['R']*a,math.pi*c['b'],c['r']*(a-be),c['b']*c['th'],c['b']*math.pi/2]
    pieces=[fixed_drop(c,np.linspace(1,0,math.ceil(c['b']*math.pi/2/spacing)+1))]
    pieces += [chunk(c,pan,i,np.linspace(0,1,max(2,math.ceil(l/spacing)+1)))[1:] for i,l in enumerate(lengths)]
    result=np.vstack(pieces)
    fixed=result[0].copy();fixed[2]-=8
    moving=result[-1].copy();moving[2]=113
    return np.vstack([np.linspace(fixed,result[0],max(2,math.ceil(8/spacing)+1))[:-1],result,np.linspace(result[-1],moving,max(2,math.ceil((113-result[-1,2])/spacing)+1))[1:]])


def projected_channel(points,radius,z,height):
    poly=LineString(points[:,:2]).buffer(radius,quad_segs=12)
    return Pos(0,0,z)*extrude(Polygon(*list(poly.exterior.coords)[:-1],align=None),amount=height,dir=(0,0,1))


def moving_floor():
    floor=ring(110,49.6,1.2,z=77.5)
    floor+=ring(53,49.6,5.3,z=78.7)
    c=specifications()['motor']
    floor-=projected_channel(chunk(c,0,4,np.linspace(0,1,41)),3,77,3)
    return floor


def moving_ceiling():
    ceiling=ring(110,50.4,1.2,z=84)
    c=specifications()["usb"]
    ceiling-=projected_channel(chunk(c,0,4,np.linspace(0,1,41)),3.5,83,4)
    ceiling-=projected_channel(chunk(specifications()["motor"],0,4,np.linspace(0,1,41)),3,83,4)
    # Open the riser slots to the outer edge for intact connectors.
    ceiling-=rounded(24,20,4,2,x=-50,y=3,z=83)
    for angle in [45,135,225,315]:
        x,y=30*math.cos(math.radians(angle)),30*math.sin(math.radians(angle))
        ceiling+=cylinder(6,3.3,x,y,85.2)
        ceiling-=cylinder(1.8,4.5,x,y,84.1)
    return ceiling


def build_guides(p,chassis):
    # Split fixed guide into three accessible, screw-clamped printed sections.
    # The four columns sit outside both cable sweeps, at the rounded corners.
    tray=ring(148,52,1.2,z=72)+ring(148,146,4.3,z=73.2)
    tray+=ring(54,52,3.9,z=73.2)+ring(112,110,4.0,z=73.2)
    shelf=ring(148,111,1.2,z=77.5)+ring(145,143,5.3,z=78.7)
    roof=ring(146,111,1.2,z=84)
    from build123d import Rot
    for x in [-54,54]:
        for y in [-54,54]:
            angle=math.degrees(math.atan2(y,x))
            for key,z,hh in [('tray',69,3.3),('shelf',77.5,6.5),('roof',84,1.2)]:
                lug=cylinder(3*2,hh,x,y,z)
                web=Rot(0,0,angle)*box(9,6,1.2,x=73,z=72 if key=='tray' else z)
                if key=='tray': tray+=lug+web
                elif key=='shelf': shelf+=lug+web
                else: roof+=lug+web
            for key in ['tray','shelf','roof']:
                if key=='tray': tray-=cylinder(2.3,20,x,y,68)
                elif key=='shelf': shelf-=cylinder(2.3,20,x,y,68)
                else:
                    roof-=cylinder(2.3,20,x,y,68)
                    roof-=cylinder(4.2,1,x,y,84.8)
            chassis+=cylinder(6,65,x,y,4)
            chassis-=cylinder(1.8,8,x,y,62)
    for c in specifications().values():
        channel=projected_channel(fixed_drop(c,np.linspace(0,1,49)),c['diam']/2+1,60,24)
        tray-=channel;shelf-=channel
    anchors={}
    for name,c in specifications().items():
        x,y,z=fixed_drop(c,1)[0]
        block=box(4,14,8,x+2.1,y,z-8)
        for yy in [-6,6]:
            block+=box(3,3,76.2-z,x+2.1,y+yy,z-4)
        block-=cylinder(c['diam']+.4,24,x,y,z-9)
        cap=box(4,13.6,8,x-2.2,y,z-8)-cylinder(c['diam']+.4,10,x,y,z-9)
        for yy in [-5,5]:
            block-=xhole(1.8,5,x,y+yy,z-4)
            cap-=xhole(2.3,6,x-5,y+yy,z-4)
        tray+=block
        anchors['fixed_'+name+'_clamp']=cap
    return chassis,{'cable_guide_tray':tray,'cable_guide_shelf':shelf,'cable_guide_roof':roof,**anchors}


def tube(c,pan=0):
    pts=points(c,pan,spacing=2)
    edge=Edge.make_spline([tuple(v) for v in pts])
    tangent=pts[1]-pts[0]
    section=Plane(origin=tuple(pts[0]),z_dir=tuple(tangent))*Circle(c['diam']/2)
    return sweep(section,path=edge)
