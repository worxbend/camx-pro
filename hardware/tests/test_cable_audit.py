import numpy as np
import trimesh

from tools.verify_cable_routing import surface_clearance


def test_centerline_deep_inside_solid_cannot_pass_as_free_space():
    mesh = trimesh.creation.box(extents=[10, 10, 10])
    points = np.array([[0, 0, 0], [8, 0, 0]], dtype=float)
    clearance, inside = surface_clearance(mesh, points, radius=1)
    assert inside.tolist() == [True, False]
    np.testing.assert_allclose(clearance, [-6, 2])
