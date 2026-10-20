"""Constant-offset bonnet, supported bosses, seam-loaded cable exit and chassis."""
import math
from build123d import Plane, Pos, Rot, RectangleRounded, loft
from .geometry import rounded, cylinder, box


def envelope(sections):
    return loft([Plane.XY.offset(z)*RectangleRounded(w, d, r)
                 for z, w, d, r in sections])


def build_enclosure(p):
    b=p["base"]
    w,d,h,wall=b["width"],b["depth"],b["height"],b["wall"]
    bosses=[(x,y) for x in [-65,65] for y in [-60,60]]
    chassis=rounded(w-4,d-4,6,34)
    chassis-=rounded(w-10,d-10,4,31,z=4)
    lip=rounded(w-8.6,d-8.6,3,32.7,z=6)-rounded(w-14.2,d-14.2,5,29.9,z=5)
    for x,y in bosses:
        lip-=cylinder(15,5,x,y,5)
    lip-=box(42,24,5,y=d/2-8,z=5)
    lip-=box(8,100,5,x=74,z=5)
    lip-=box(8,80,5,x=-74,y=-12,z=5)
    chassis+=lip
    outer=envelope([(6.3,w-2,d-2,36),(14,w,d,38),(h-22,w-2,d-2,42),(h,w-8,d-8,44)])
    opening=[face for face in outer.faces() if abs(face.center().Z-6.3)<1e-4]
    cover=outer.offset_3d(opening,-wall)
    cover-=cylinder(128,wall+2,z=h-wall-.1)
    for x,y in bosses:
        angle=math.degrees(math.atan2(y,x))
        web=Pos(x,y,6.3)*Rot(0,0,angle)*box(24,8,18,x=7)
        cover+=(cylinder(14,18,x,y,6.3)+web)&outer
        cover-=cylinder(2.6,17,x,y,6.2)
        chassis-=cylinder(3.4,12,x,y,-1)
        chassis-=cylinder(6.2,2.3,x,y,-.1)
    cover-=box(12,20,6,36,d/2,27)
    # Open to the assembly seam: the intact USB plug is laid in, never threaded.
    # The removable insert reduces the opening around the cable after assembly.
    exit_x=0
    cover-=box(24,22,24,exit_x,d/2,6.2)
    insert=box(23.4,3,23.7,exit_x,d/2-4,6.3)
    insert-=Pos(exit_x,d/2+3,25)*Rot(90,0,0)*cylinder(p['camera']['cable_diameter']+.6,15)
    # Split insert at the cable centerline, secured to substantial internal ears.
    inserts={}
    for name,z,hh in [('lower',6.3,18.7),('upper',25,5)]:
        part=insert & box(30,8,hh,exit_x,d/2-4,z)
        for x in [-9,9]:
            part-=Pos(x,d/2+1,z+hh/2)*Rot(90,0,0)*cylinder(2.3,12)
            ear=box(10,8,hh,math.copysign(10,x),d/2-10,z)
            ear-=Pos(x,d/2,z+hh/2)*Rot(90,0,0)*cylinder(1.8,20)
            # Overlap outer wall beyond the seam opening on both sides.
            ear+=box(5,9,hh,math.copysign(14.5,x),d/2-2.5,z)
            cover+=ear&outer
        inserts['cable_exit_'+name]=part
    chassis-=cylinder(34,6,z=-1)
    chassis-=cylinder(42.5,2.1,z=-.1)
    hatch=cylinder(42,2)
    for x in [-18.5,18.5]:
        chassis+=cylinder(8,6,x,0,2)
        chassis-=cylinder(1.8,8,x,0,1.9)
        hatch-=cylinder(2.3,4,x,0,-1)
        hatch-=cylinder(4.2,1.3,x,0,-.1)
    for x in [-p['motor']['ear_pitch']/2,p['motor']['ear_pitch']/2]:
        chassis+=cylinder(6.8,19,x,8,4)
        chassis-=cylinder(2.6,10,x,8,14)
    for angle in [45,135,225,315]:
        x,y=43*math.cos(math.radians(angle)),43*math.sin(math.radians(angle))
        chassis+=cylinder(8,22.5,x,y,4)
        chassis-=cylinder(2.6,14,x,y,13)
    for x in [-52,-44,44,52]:
        for y in [-20,20]:
            chassis-=rounded(3,13,6,1.4,x,y,-1)
    return chassis,cover,hatch,inserts
