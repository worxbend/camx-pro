import math
import pytest
from build123d import Pos, Rot
from cad.geometry import cylinder
from cad.transmissions import gear, profile_points


def test_involute_bounds_and_single_solid():
    points = profile_points(24, 1, backlash=0.125)
    radii = [math.hypot(*point) for point in points]
    assert min(radii) == pytest.approx(10.75)
    assert max(radii) == pytest.approx(13)
    shape = gear(24, 1, 5, backlash=0.125)
    assert shape.is_valid
    assert len(shape.solids()) == 1


def test_planetary_mesh_at_several_carrier_phases():
    from cad.config import load
    from cad.planetary import gearset
    parts=gearset(load())
    for angle in [0,.5,2,5,9,30,45]:
        sun=Rot(0,0,4*angle)*parts['planetary_sun']
        planet=Rot(0,0,angle)*Pos(25,0,0)*Rot(0,0,-3*angle)*Pos(-25,0,0)*parts['planetary_planet_0']
        for other in [sun,parts['planetary_ring']]:
            overlap=other & planet
            assert overlap.volume < .01, f'Planetary interference at {angle}: {overlap.volume}'
