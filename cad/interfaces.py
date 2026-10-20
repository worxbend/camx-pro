"""Shared mating dimensions and explicit P3 axial stacks (millimeters)."""
import math
from build123d import Pos, RegularPolygon, extrude
from .geometry import box


def bearing_pocket(p, diameter):
    return diameter + p["fit"]["bearing_diametral"]


def pan_stack(p):
    g = p["pan"]
    lower = g["bearing_z"]
    upper = lower + g["bearing_spacing"]
    top = upper + g["bearing_width"]
    return {
        "carrier_bottom": lower-6, "carrier_top": lower-2,
        "lower_outer_seat": lower, "upper_outer_seat": top,
        "lower_inner_shoulder": lower-p["interfaces"]["output_endplay"]/2,
        "upper_inner_shoulder": top+p["interfaces"]["output_endplay"]/2,
        "journal_od": g["bearing_id"]-p["fit"]["journal_diametral"],
        "pocket_od": bearing_pocket(p,g["bearing_od"]),
        "inner_spacer_height": g["bearing_spacing"]-g["bearing_width"],
        "housing_bottom": lower-1.2,
    }


def hex_prism(af, height, x=0, y=0, z=0, rotation=30):
    return Pos(x,y,z)*extrude(RegularPolygon(af/math.sqrt(3),6,rotation=rotation),
                              amount=height)


def slot_x(diameter, length, x, y, z, travel=0, angle=0):
    """A true capsule extruded along X, not three overlapping drill holes."""
    from .geometry import xhole
    from build123d import Rot
    if travel == 0:
        return xhole(diameter,length,x,y,z)
    shape = xhole(diameter,length,0,-travel,0)+xhole(diameter,length,0,travel,0)
    shape += box(length,2*travel,diameter,x=length/2,z=-diameter/2)
    return Pos(x,y,z)*Rot(angle,0,0)*shape
