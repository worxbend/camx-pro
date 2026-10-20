from cad.base import build_base
from cad.config import load


def test_base_components_are_connected_solids():
    parts = build_base(load())
    for name, shape in parts.items():
        assert shape.is_valid, name
        assert len(shape.solids()) == 1, (name, len(shape.solids()))
        assert shape.volume > 0, name
    # The enlarged bonnet may curve outside its nominal footprint. Probe the
    # actual front wall rather than a fixed P2-era coordinate inside the cavity.
    from tools.verify_mechanical_interfaces import ray_hits
    for z in [48,60,80]:
        hits=ray_hits(parts['base_lid'],(0,0,z),(0,-1,0))
        assert len(hits)==2
        assert 2.99 <= hits[1]-hits[0] <= 4
        assert parts['base_lid'].is_inside((0,-sum(hits)/2,z))
