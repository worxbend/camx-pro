"""Concealed 2:1 timing drive. Purchased pulley/belt envelopes, not tooth tooling."""
import math
from build123d import Circle, Face, Wire, Pos, Rot, extrude
from .geometry import cylinder, ring, along_x


def belt_length(center, r, R):
    delta = R-r
    return 2*math.sqrt(center**2-delta**2)+math.pi*(R+r)+2*delta*math.asin(delta/center)


def drive_datums(p):
    t = p["tilt"]
    r = t["motor_teeth"]*t["belt_pitch"]/(2*math.pi)
    R = t["axis_teeth"]*t["belt_pitch"]/(2*math.pi)
    lo, hi = R+r+1, t["belt_length"]
    if belt_length(lo,r,R) >= t['belt_length']:
        raise ValueError('Belt too short for separated pulley envelopes')
    for _ in range(60):
        mid = (lo+hi)/2
        if belt_length(mid,r,R) < t["belt_length"]:
            lo = mid
        else:
            hi = mid
    center = (lo+hi)/2
    dz = t["motor_z"]-t["axis_z"]
    if abs(dz) >= center:
        raise ValueError('Motor height exceeds available belt center distance')
    y = math.sqrt(center**2-dz**2)
    theta = math.degrees(math.atan2(dz,y))
    return {"motor_y": y, "motor_z": t["motor_z"], "motor_face": t["arm_inner"]+1,
            "motor_back": t["arm_inner"]+1-p["motor"]["depth"], "motor_roll": theta, "center_distance": center,
            "motor_pitch_radius": r, "axis_pitch_radius": R, "belt_plane": t["arm_inner"]+19,
            "tilt_ratio": t["axis_teeth"]/t["motor_teeth"]}


def motor_location(p):
    d = drive_datums(p)
    return Pos(d["motor_back"],d["motor_y"],d["motor_z"])*Rot(d["motor_roll"],0,0)*Rot(0,90,0)


def yz_profile(centers, radii):
    edges = []
    for (y,z),r in zip(centers,radii):
        edges.extend((Pos(y,z)*Circle(r)).edges())
    return Face(Wire.make_convex_hull(edges, tolerance=1e-4))


def yz_extrusion(profile, x, thickness):
    return Pos(x,0,0)*Rot(0,0,90)*Rot(90,0,0)*extrude(profile,amount=thickness,dir=(0,0,1))


def belt_envelope(p):
    d = drive_datums(p)
    centers = [(0,p["tilt"]["axis_z"]),(d["motor_y"],d["motor_z"])]
    radii = [d["axis_pitch_radius"],d["motor_pitch_radius"]]
    outer = yz_profile(centers,[r+1.5 for r in radii])
    inner = yz_profile(centers,[r+.35 for r in radii])
    x = d["belt_plane"]-p["tilt"]["belt_width"]/2
    return yz_extrusion(outer,x,p["tilt"]["belt_width"]) - yz_extrusion(inner,x-1,p["tilt"]["belt_width"]+2)


def pulley(p, driven=False):
    d = drive_datums(p)
    radius = d["axis_pitch_radius"] if driven else d["motor_pitch_radius"]
    first_flange=d["belt_plane"]-4
    bore, hub, start = (8,18,p["tilt"]["arm_inner"]+10) if driven else (5,12,d["motor_face"]+.3)
    shape = ring(hub,bore,first_flange-start,z=start)
    shape += ring(radius*2+5,bore,1,z=first_flange)
    shape += ring(radius*2-.508,bore,6,z=first_flange+1)
    shape += ring(radius*2+5,bore,1,z=first_flange+7)
    y,z = (0,p["tilt"]["axis_z"]) if driven else (d["motor_y"],d["motor_z"])
    return Pos(0,y,z)*Rot(0,90,0)*shape
