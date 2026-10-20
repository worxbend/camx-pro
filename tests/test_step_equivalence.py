from build123d import Box, Cylinder

from tools.validate_artifacts import equivalent_boundary


def test_matching_outer_bounds_do_not_hide_a_changed_internal_feature():
    original = Box(10, 10, 10)
    altered = original - Cylinder(1, 20)
    assert equivalent_boundary(original, original)
    assert not equivalent_boundary(original, altered)
