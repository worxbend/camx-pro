import math
import pytest
from cad.config import load
from cad.tilt_drive import belt_length, drive_datums


def test_equal_pulley_belt_length():
    # Equal pulleys have two straight spans and a combined full wrap.
    assert belt_length(50,10,10) == pytest.approx(100+20*math.pi)


def test_infeasible_belt_and_motor_offsets_are_rejected():
    p=load()
    p['tilt']['belt_length']=40
    with pytest.raises(ValueError,match='too short'):
        drive_datums(p)
    p=load()
    p['tilt']['motor_z']=1
    with pytest.raises(ValueError,match='height'):
        drive_datums(p)
