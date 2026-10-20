"""Audit-tool tests use independent synthetic geometry and G-code edge cases."""
import pytest
import trimesh
from shapely.geometry import box

from tools.verify_print_layers import disk_diameter, inspect
from tools.verify_slicing import extrusion_bounds


def test_extrusion_bounds_exclude_travel_and_retractions_but_include_segment_start():
    text = """
G90
M82
G92 E0
G1 X5 Y6
;TYPE:External perimeter
G1 X15 Y6 E1
G1 X170 Y170 E0.5
G1 X15 Y16 E0.5
G1 X5 Y16 E2
G92 E0
G1 X5 Y6 E1
"""
    bounds, features = extrusion_bounds(text)
    assert bounds == [[5,6],[15,16]]
    assert features == {"External perimeter": 3}


def test_relative_extrusion_and_unsupported_motion():
    bounds, _ = extrusion_bounds("M83\nG1 X2 Y3\nG1 X9 Y8 E.5\nG1 X4 Y3 E1\n")
    assert bounds == [[2,3],[9,8]]
    with pytest.raises(ValueError, match="Unsupported"):
        extrusion_bounds("G91\n")
    with pytest.raises(ValueError, match="No positive"):
        extrusion_bounds("G1 X1 Y1\n")


def test_upright_box_has_no_growth_and_expected_bed_contact():
    mesh = trimesh.creation.box(extents=[10,8,2])
    mesh.apply_translation([0,0,1])
    result = inspect(mesh,.2)
    assert result["layers"] == 10
    assert result["first_layer_area_mm2"] == pytest.approx(80)
    assert result["largest_unsupported_patch"]["area_mm2"] == 0
    assert result["section_errors"] == []


def test_overhanging_cap_is_detected():
    pillar = trimesh.creation.box(extents=[2,2,2])
    pillar.apply_translation([0,0,1])
    cap = trimesh.creation.box(extents=[10,10,1])
    cap.apply_translation([0,0,2.5])
    result = inspect(trimesh.util.concatenate([pillar,cap]),.2)
    assert result["largest_unsupported_patch"]["area_mm2"] > 90
    assert result["layers_exceeding_45_degree_growth"] > 0
    assert disk_diameter(box(-5,-2,5,2)) == pytest.approx(4,abs=.002)


def test_floating_body_after_empty_layers_is_not_silently_skipped():
    mesh = trimesh.creation.box(extents=[4,4,1])
    mesh.apply_translation([0,0,2.5])
    result = inspect(mesh,.2)
    assert result["first_layer_area_mm2"] == 0
    assert result["new_islands_without_previous_layer_contact"]
    assert result["largest_unsupported_patch"]["area_mm2"] == pytest.approx(16)
