"""Printed substitutes for purchased P3 hardware, built inside the purchased envelopes.

Every substitute keeps the bore, outside diameter, width and datum of the part it
replaces, so the P3 printed parts and their reports stay unchanged. Bearings are
print-in-place; their running clearance comes from the clearance coupon.
"""
import json
import math
from dataclasses import dataclass
from pathlib import Path
from build123d import (Axis, Circle, Compound, Kind, Plane, PolarLocations, Polygon, Pos, Rot,
                       extrude, offset, revolve)
from cad.config import load as load_p3
from cad.geometry import box, cylinder, flat_shaft, ring
from cad.tilt_drive import drive_datums

HERE = Path(__file__).resolve().parent


@dataclass
class Part:
    name: str
    shape: object
    quantity: int
    material: str
    replaces: str
    print_rotation: tuple = (0, 0, 0)
    print_in_place: bool = False
    note: str = ""


def load():
    return json.loads((HERE / "parameters.json").read_text())


def section(points):
    """Closed (radius, height) polygon on the XZ plane, ready to revolve about Z."""
    return Plane.XZ * Polygon(*points, align=None)


def roller_profile(k, center=0.0, extend=0.0):
    """Bicone roller: end bands, 45-degree flanks and a ridge that interlocks both races."""
    a, e, f = k["roller_end_diameter"] / 2, k["roller_ridge"], k["roller_flat"]
    height = 7 - k["roller_top_gap"]
    band = (height - 2 * e - f) / 2
    half = [(a, -extend), (a, band), (a + e, band + e), (a + e, band + e + f),
            (a, band + 2 * e + f), (a, height + extend)]
    return [(center + r, z) for r, z in half] + [(center - r, z) for r, z in reversed(half)]


def output_bearing(p3, k, clearance):
    """6809 substitute: two races and bicone rollers printed in place, without a cage."""
    g = p3["pan"]
    width = g["bearing_width"]
    pitch = (g["bearing_id"] + g["bearing_od"]) / 4
    track = revolve(offset(section(roller_profile(k, pitch, 1.5)), clearance,
                           kind=Kind.INTERSECTION), Axis.Z)
    inner = ring(2 * pitch, g["bearing_id"], width) - track
    outer = ring(g["bearing_od"], 2 * pitch, width) - track
    half = [(r, z) for r, z in roller_profile(k) if r >= 0]
    roller = revolve(section([(0, half[0][1]), *half, (0, half[-1][1])]), Axis.Z)
    rollers = [loc * roller for loc in PolarLocations(pitch, k["rollers"])]
    return Compound(children=[inner, outer, *rollers])


def small_bearing(p3, k, clearance):
    """688 substitute: a ridged inner sleeve captured in a grooved outer ring."""
    t = p3["tilt"]
    width, bore = t["bearing_width"], t["bearing_id"] / 2
    land, ridge, flat = k["land_diameter"] / 2, k["ridge"], k["ridge_flat"]
    band = (width - 2 * ridge - flat) / 2

    def profile(extend):
        return [(bore, -extend), (land, -extend), (land, band), (land + ridge, band + ridge),
                (land + ridge, band + ridge + flat), (land, width - band),
                (land, width + extend), (bore, width + extend)]
    inner = revolve(section(profile(0)), Axis.Z)
    gap = revolve(offset(section(profile(1)), clearance, kind=Kind.INTERSECTION), Axis.Z)
    outer = cylinder(t["bearing_od"], width) - cylinder(2 * land, width + 2, z=-1) - gap
    return Compound(children=[inner, outer])


def d_bore(diameter, flat_depth, allowance, height, z=0):
    """Round bore with one flat on +X, matching the printed trunnion."""
    size = diameter + allowance
    flat = diameter / 2 - flat_depth + allowance / 2
    return cylinder(size, height, z=z) & box(flat + size, size + 1, height, x=(flat - size) / 2, z=z)


def set_screw(k, hub, radial_start, z):
    """M2 radial set screw along +X with a square nut slot opening on +Y."""
    width, thickness = k["nut_slot"]
    hole = Pos(0, 0, z) * Rot(0, 90, 0) * cylinder(k["set_screw_hole"], hub + 1)
    nut = box(thickness, hub + 1 + width / 2, width, x=radial_start + thickness / 2,
              y=(hub + 1 - width / 2) / 2, z=z - width / 2)
    return hole + nut


def pulley(p3, h, driven=False):
    """GT2-form pulley inside the P3 pulley envelope; local Z is the world X axis.

    The belt-side flange prints on the bed. The hub-side lip is a 45-degree cone in
    the 1 mm between the teeth and the belt edge, so neither flange overhangs.
    """
    k, s, t = h["pulley"], h["shaft"], p3["tilt"]
    d = drive_datums(p3)
    pitch_radius = d["axis_pitch_radius"] if driven else d["motor_pitch_radius"]
    teeth = t["axis_teeth"] if driven else t["motor_teeth"]
    tip = pitch_radius - .254
    root = tip - k["groove_depth"]
    first_flange = d["belt_plane"] - 4
    hub, start = (9, t["arm_inner"] + 10) if driven else (6, d["motor_face"] + .3)
    lip = tip + k["lip_height"]
    flange = pitch_radius + 2.5
    teeth_end = first_flange + 7
    body = revolve(section([
        (0, start), (hub, start), (hub, first_flange), (lip, first_flange),
        (lip, first_flange + 1), (tip, first_flange + 1 + k["lip_height"]),
        (root - .05, first_flange + 1 + k["lip_height"]), (root - .05, teeth_end),
        (flange, teeth_end), (flange, teeth_end + 1), (0, teeth_end + 1)]), Axis.Z)
    grooves = Circle(tip) - PolarLocations(tip - k["groove_depth"] + k["groove_radius"], teeth) \
        * Circle(k["groove_radius"])
    body += Pos(0, 0, first_flange + 1) * extrude(grooves, amount=6)
    length = teeth_end + 2 - start
    if driven:
        body -= d_bore(s["diameter"], s["flat_depth"], k["bore_allowance"], length, start - .5)
        flat = s["diameter"] / 2 - s["flat_depth"] + k["bore_allowance"] / 2
        body -= set_screw(k, hub, flat + .6, (start + first_flange) / 2)
    else:
        m = p3["motor"]
        body -= Pos(0, 0, start - .5) * flat_shaft(m["shaft_diameter"], m["shaft_flats"], length,
                                                   k["bore_allowance"])
        # The Ø4.5 yoke service bore at X = arm_inner + 4 still reaches the screw
        # 0.5 mm outboard, which leaves a 1 mm floor under the nut slot.
        body -= set_screw(k, hub, (m["shaft_flats"] + k["bore_allowance"]) / 2 + .85,
                          t["arm_inner"] + 4.5)
    return body


def place_pulley(p3, shape, driven=False):
    """Assembly placement used by the P3 pulley envelope (for interface checks)."""
    d = drive_datums(p3)
    y, z = (0, p3["tilt"]["axis_z"]) if driven else (d["motor_y"], d["motor_z"])
    return Pos(0, y, z) * Rot(0, 90, 0) * shape


def belt(p3, h, length_offset=0.0):
    """Endless TPU belt printed flat as a ring, teeth inward; its pitch line is the
    nominal P3 belt length plus the chosen offset (negative pre-tensions it)."""
    k, t = h["belt"], p3["tilt"]
    teeth = round(t["belt_length"] / t["belt_pitch"])
    pitch_radius = (t["belt_length"] + length_offset) / (2 * math.pi)
    land = pitch_radius - k["pitch_line_offset"]
    profile = Circle(land + k["back"]) - Circle(land)
    profile += PolarLocations(land - k["tooth_height"] + k["tooth_radius"], teeth) \
        * Circle(k["tooth_radius"])
    profile -= Circle(land - k["tooth_height"])
    return extrude(profile, amount=t["belt_width"])


def trunnion(h):
    """28 mm tilt shaft with a 0.4 mm flat for the pulley and collar set screws."""
    s = h["shaft"]
    flat = s["diameter"] / 2 - s["flat_depth"]
    return cylinder(s["diameter"], 28) - box(s["diameter"], s["diameter"] + 1, 30,
                                             x=flat + s["diameter"] / 2, z=-1)


def collar(h):
    s = h["shaft"]
    shape = cylinder(16, 5) - d_bore(s["diameter"], s["flat_depth"], .2, 7, -1)
    flat = s["diameter"] / 2 - s["flat_depth"] + .1
    return shape - set_screw(h["pulley"], 8, flat + .6, 2.5)


def coupon(p3, h):
    """Small bearings at each coupon clearance; notch count = position in the list."""
    pieces = []
    for i, clearance in enumerate(h["clearance"]["coupon"]):
        bearing = small_bearing(p3, h["small_bearing"], clearance)
        inner, outer = bearing.solids()
        for j in range(i + 1):
            outer -= Rot(0, 0, 25 * j) * box(1.2, .8, 7, x=8, z=-1)
        pieces += [Pos(20 * i, 0, 0) * inner, Pos(20 * i, 0, 0) * outer]
    return Compound(children=pieces)


def build(p3=None, h=None):
    p3, h = p3 or load_p3(), h or load()
    c = h["clearance"]["print_in_place"]
    m = h["materials"]
    sleeve = h["sleeve"]
    parts = [
        Part("output_bearing_6809", output_bearing(p3, h["output_bearing"], c), 2, m["bearing"],
             "6809 bearing (45 x 58 x 7 mm)", print_in_place=True,
             note="Print-in-place; break the rollers free before fitting."),
        Part("small_bearing_688", small_bearing(p3, h["small_bearing"], c), 7, m["bearing"],
             "688 bearing (8 x 16 x 5 mm): 4 planets, sun, 2 tilt", print_in_place=True,
             note="Print-in-place plain bearing; break free and run in."),
        Part("planet_pin_sleeve", ring(sleeve["outer_diameter"], sleeve["bore"], 14.5), 4,
             m["structural"], "Steel planet pin sleeve (8 x 3.2 x 14.5 mm)"),
        Part("planet_shim_lower", ring(11, 8.2, .2), 4, m["structural"],
             "Planet lower shim (11 x 8.2 x 0.2 mm)", note="Single 0.2 mm layer."),
        Part("planet_shim_upper", ring(11, 8.2, 6.7), 4, m["structural"],
             "Planet upper shim (11 x 8.2 x 6.7 mm)"),
        Part("output_inner_spacer", ring(48, 45.15, 5), 1, m["structural"],
             "Output inner spacer (48 x 45.15 x 5 mm)"),
        *[Part(f"output_shim_{str(t).replace('.', 'p')}", ring(48, 45.15, t), 2,
               m["structural"], "Output adjustment shim (as fitted)") for t in h["output_shims"]],
        Part("tilt_trunnion", trunnion(h), 2, m["structural"], "Steel trunnion (8 x 28 mm)",
             (0, 90, 0), note="Prints lying on its flat so layers run along the shaft."),
        Part("tilt_inner_spacer", ring(11, 8.15, 2.1), 2, m["structural"],
             "Tilt inner spacer (11 x 8.15 x 2.1 mm)"),
        Part("tilt_outer_spacer", ring(11, 8.15, 3.9), 2, m["structural"],
             "Tilt outer spacer (11 x 8.15 x 3.9 mm)"),
        Part("tilt_passive_collar", collar(h), 1, m["structural"],
             "Passive shaft collar (16 x 5 mm, 8 mm bore)", note="M2 grub screw and square nut."),
        Part("tilt_drive_pulley_20t", pulley(p3, h), 1, m["structural"], "20T GT2 pulley (5 mm bore)",
             (180, 0, 0), note="M2 grub screw and square nut; prints belt flange down."),
        Part("tilt_axis_pulley_40t", pulley(p3, h, True), 1, m["structural"],
             "40T GT2 pulley (8 mm bore)", (180, 0, 0),
             note="D bore on the trunnion flat; M2 grub screw and square nut."),
    ]
    for length in h["belt"]["length_offsets"]:
        suffix = "" if length == 0 else f"_{str(abs(length)).replace('.', 'p')}mm_short"
        parts.append(Part(f"tilt_belt_tpu{suffix}", belt(p3, h, length), 1, m["belt"],
                          "160 mm x 4 mm GT2 endless belt",
                          note="Print one per length; fit the one that tensions within the "
                               "motor slot."))
    parts.append(Part("clearance_coupon", coupon(p3, h), 1, m["bearing"],
                      "Print first: selects clearance.print_in_place", print_in_place=True,
                      note="Notches count the coupon list position; use the tightest one that "
                           "frees by hand."))
    return parts
