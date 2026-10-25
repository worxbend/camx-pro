import math
import pytest
from build123d import Pos
from cad.config import load as load_p3
from cad.tilt_drive import drive_datums, pulley as p3_pulley
from printed_hardware.parts import (belt, build, load, output_bearing, place_pulley, pulley,
                                    small_bearing)


@pytest.fixture(scope="module")
def p3():
    return load_p3()


@pytest.fixture(scope="module")
def h():
    return load()


def overlap(a, b):
    shape = a & b
    return sum(s.volume for s in shape.solids()) if shape is not None else 0


def test_parts_are_valid_and_single_unless_printed_in_place(p3, h):
    for part in build(p3, h):
        assert part.shape.is_valid, part.name
        if not part.print_in_place:
            assert len(part.shape.solids()) == 1, part.name


def test_output_bearing_keeps_6809_envelope_and_captures_rollers(p3, h):
    bearing = output_bearing(p3, h["output_bearing"], .3)
    size = bearing.bounding_box().size
    assert (size.X, size.Z) == pytest.approx((58, 7))
    solids = sorted(bearing.solids(), key=lambda s: s.volume, reverse=True)
    races, rollers = solids[:2], solids[2:]
    assert len(rollers) == h["output_bearing"]["rollers"]
    assert min(r.distance_to(rollers[0]) for r in races) == pytest.approx(.3, abs=1e-3)
    assert rollers[0].distance_to(rollers[1]) > .5
    # The ridge locks rollers axially: a 0.5 mm lift already collides with a race.
    assert overlap(Pos(0, 0, .5) * rollers[0], races[0]) > 0
    # Race faces stay inside the P3 inner (Ø48) and outer (Ø55) spacer lands.
    a = h["output_bearing"]["roller_end_diameter"] / 2
    pitch = (p3["pan"]["bearing_id"] + p3["pan"]["bearing_od"]) / 4
    assert pitch - a - .3 >= p3["interfaces"]["output_inner_land_od"] / 2
    assert pitch + a + .3 <= p3["interfaces"]["output_outer_land_id"] / 2


def test_small_bearing_keeps_688_envelope_and_interlocks(p3, h):
    bearing = small_bearing(p3, h["small_bearing"], .3)
    size = bearing.bounding_box().size
    assert (size.X, size.Z) == pytest.approx((16, 5))
    inner, outer = sorted(bearing.solids(), key=lambda s: s.bounding_box().size.X)
    assert inner.bounding_box().size.X < 14
    assert inner.distance_to(outer) == pytest.approx(.3, abs=1e-3)
    assert overlap(Pos(0, 0, .5) * inner, outer) > 0
    land = h["small_bearing"]["land_diameter"]
    assert p3["interfaces"]["tilt_inner_land_od"] <= land
    assert land + .6 <= p3["interfaces"]["tilt_outer_land_id"]


@pytest.mark.parametrize("driven", [False, True])
def test_pulleys_fill_the_p3_pulley_envelope(p3, h, driven):
    new = place_pulley(p3, pulley(p3, h, driven), driven).bounding_box()
    old = p3_pulley(p3, driven).bounding_box()
    assert tuple(new.min) == pytest.approx(tuple(old.min), abs=.01)
    assert tuple(new.max) == pytest.approx(tuple(old.max), abs=.01)


def test_belt_matches_pitch_length_and_pulley_grooves(p3, h):
    k, g, t = h["belt"], h["pulley"], p3["tilt"]
    land = t["belt_length"] / (2 * math.pi) - k["pitch_line_offset"]
    size = belt(p3, h).bounding_box().size
    assert size.X == pytest.approx(2 * (land + k["back"]), abs=.01)
    assert size.Z == pytest.approx(t["belt_width"])
    assert k["tooth_radius"] < g["groove_radius"]
    assert k["tooth_height"] < g["groove_depth"]
    # Wrapped on a pulley, the back stays inside the P3 belt envelope (pitch + 1.5 mm).
    assert k["back"] - k["pitch_line_offset"] < 1.5
    shorter = belt(p3, h, -1.6).bounding_box().size.X
    assert size.X - shorter == pytest.approx(1.6 / math.pi, abs=.01)


def test_pulley_lip_stops_at_the_belt_edge(p3, h):
    # The 45-degree hub-side lip occupies the gap between the teeth and the belt.
    d = drive_datums(p3)
    lip_end = d["belt_plane"] - 4 + 1 + h["pulley"]["lip_height"]
    assert lip_end <= d["belt_plane"] - p3["tilt"]["belt_width"] / 2 + 1e-9
