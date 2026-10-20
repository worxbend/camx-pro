import pytest
from cad.config import changed, load, pan_motor_offset, pan_ratio


def test_a1_mini_and_transmission():
    p = load()
    assert p["printer"]["bed"] == [180, 180, 180]
    assert pan_ratio(p) == 4
    assert pan_motor_offset(p) == 0
    assert not p["motion"]["commissioned"]


def test_impossible_camera_and_spindle_fail_early():
    p = load()
    with pytest.raises(ValueError, match="opening"):
        changed(p, "camera", width=80)
    with pytest.raises(ValueError, match="spindle"):
        changed(p, "pan", cable_bore=42)
    with pytest.raises(ValueError, match="Non-finite"):
        changed(p, "motor", depth=float("nan"))


def test_invalid_planetary_assembly_is_rejected():
    p=load()
    with pytest.raises(ValueError,match='center distance'):
        changed(p,'pan',ring_teeth=64)
    with pytest.raises(ValueError,match='equally spaced'):
        changed(p,'pan',planet_count=3)
    with pytest.raises(ValueError,match='integers'):
        changed(p,'pan',planet_count=4.5)
