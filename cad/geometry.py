"""Small shared construction helpers. All box/cylinder Z coordinates are bottom faces."""
from build123d import Align, Axis, Box, Cylinder, Pos, Rot

BOTTOM = (Align.CENTER, Align.CENTER, Align.MIN)


def box(w, d, h, x=0, y=0, z=0):
    return Pos(x, y, z) * Box(w, d, h, align=BOTTOM)


def cylinder(d, h, x=0, y=0, z=0):
    return Pos(x, y, z) * Cylinder(d / 2, h, align=BOTTOM)


def ring(od, inner, h, x=0, y=0, z=0):
    return cylinder(od, h, x, y, z) - cylinder(inner, h + 2, x, y, z - 1)


def rounded(w, d, h, radius, x=0, y=0, z=0):
    shape = Box(w, d, h, align=BOTTOM)
    shape = shape.fillet(radius, shape.edges().filter_by(Axis.Z))
    return Pos(x, y, z) * shape


def along_x(shape, x, y, z):
    return Pos(x, y, z) * Rot(0, 90, 0) * shape


def xhole(d, length, x, y, z):
    return along_x(cylinder(d, length), x, y, z)


def flat_shaft(diameter, flats, height, clearance=0):
    return cylinder(diameter + clearance, height) & box(flats + clearance, diameter + clearance + 1, height)
