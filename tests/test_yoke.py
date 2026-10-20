from cad.yoke import build_yoke
from cad.config import load


def test_yoke_parts_are_connected():
    parts, _ = build_yoke(load())
    for name, shape in parts.items():
        assert shape.is_valid, name
        assert len(shape.solids()) == 1, (name,len(shape.solids()))
    # A rectangular clamp previously collided with the conduit fillet.
    from tools.check_interference import volume
    assert volume(parts['moving_cable_clamp'],parts['gimbal_yoke']) < .001
