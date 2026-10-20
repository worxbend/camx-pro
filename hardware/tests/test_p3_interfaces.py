"""Regression tests for actual construction/kinematic failures found in the P3 review."""
import numpy as np
import pytest
from cad.cables import projected_channel, specifications, points
from cad.interfaces import pan_stack
from cad.config import load, changed


def test_clockwise_projected_route_cut_goes_upward():
    shape=projected_channel(np.array([[0,0,0],[10,0,0],[15,5,0]]),3,77,3)
    bounds=shape.bounding_box()
    assert bounds.min.Z==pytest.approx(77)
    assert bounds.max.Z==pytest.approx(80)
    assert shape.is_inside((5,0,78))


def test_rolling_routes_conserve_length_and_keep_fixed_anchor():
    for c in specifications().values():
        paths=[points(c,a,.2) for a in [-160,-80,0,80,160]]
        lengths=[np.linalg.norm(np.diff(v,axis=0),axis=1).sum() for v in paths]
        assert max(lengths)-min(lengths)<.01
        for path in paths:
            assert path[0]==pytest.approx(paths[0][0])
            assert path[-1,2]==pytest.approx(113)
        assert np.linalg.norm(paths[0][-1,:2])==pytest.approx(np.linalg.norm(paths[-1][-1,:2]))


def test_output_fit_and_endplay_change_the_actual_stack_contract():
    p=load();q=changed(p,'fit',bearing_diametral=.4,journal_diametral=.25)
    assert pan_stack(q)['pocket_od']-pan_stack(p)['pocket_od']==pytest.approx(.2)
    assert pan_stack(q)['journal_od']-pan_stack(p)['journal_od']==pytest.approx(-.1)
    s=pan_stack(p)
    assert s['upper_inner_shoulder']-s['lower_inner_shoulder']==pytest.approx(2*p['pan']['bearing_width']+s['inner_spacer_height']+p['interfaces']['output_endplay'])
