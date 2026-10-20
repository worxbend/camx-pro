from types import SimpleNamespace
from tools.validate_motion import relative_pose_key


def test_motion_cache_cancels_only_shared_transforms():
    fixed=SimpleNamespace(group='fixed')
    pan=SimpleNamespace(group='pan')
    camera=SimpleNamespace(group='tilt')
    motor=SimpleNamespace(group='tilt_drive')
    assert relative_pose_key(camera,motor,80,45) == relative_pose_key(camera,motor,-80,45)
    assert relative_pose_key(camera,motor,80,45) != relative_pose_key(camera,motor,80,30)
    assert relative_pose_key(fixed,camera,80,45) != relative_pose_key(fixed,camera,-80,45)
    assert relative_pose_key(fixed,pan,80,45) == relative_pose_key(fixed,pan,80,30)
