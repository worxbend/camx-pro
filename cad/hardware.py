"""Simplified non-print envelopes; unknown dimensions remain provisional."""
from build123d import Pos, Rot, Axis
from .geometry import box, cylinder, flat_shaft, rounded, xhole


def motor_shaft(p):
    m = p["motor"]
    return Pos(0, 0, m["depth"]) * flat_shaft(
        m["shaft_diameter"], m["shaft_flats"], m["shaft_length"]
    )


def motor(p):
    m = p["motor"]
    body = cylinder(m["diameter"], m["depth"], y=m["shaft_offset"])
    body += box(m["ear_pitch"], 6, m["ear_thickness"], y=m["shaft_offset"], z=m["depth"] - m["ear_thickness"])
    for x in [-m["ear_pitch"] / 2, m["ear_pitch"] / 2]:
        body += cylinder(m["ear_diameter"], m["ear_thickness"], x, m["shaft_offset"], m["depth"] - m["ear_thickness"])
        body -= cylinder(m["hole"], 4, x, m["shaft_offset"], m["depth"] - 2)
    body += box(15, 6, 7, y=m["shaft_offset"] + m["diameter"] / 2, z=3)
    return body


def camera(p):
    c, axis = p["camera"], p["tilt"]["axis_z"]
    body = box(c["width"], c["depth"], c["height"], z=axis - c["height"] / 2)
    body = body.fillet(7, body.edges().filter_by(Axis.Y))
    body = body.fillet(1.5, body.edges().filter_by_position(Axis.Y,-c["depth"]/2,-c["depth"]/2))
    # The factory folded clip is included in the full height parameter.
    return body


def camera_front(p):
    c, axis = p['camera'],p['tilt']['axis_z']
    return Pos(0,-c['depth']/2-.6,axis)*Rot(-90,0,0)*rounded(c['width']-4,c['height']-4,.5,7)


def camera_lens(p):
    c, axis = p["camera"], p["tilt"]["axis_z"]
    return Pos(0, -c["depth"] / 2 - 1, axis + 2) * Rot(90, 0, 0) * cylinder(23, 1.2)


def board(size, x, y, z, vertical=False):
    length, width, height = size
    if vertical:
        return box(height, length, width, x, y, z)
    return box(width, length, height, x, y, z)
