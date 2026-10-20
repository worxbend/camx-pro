"""Load and validate dimensional inputs without importing the CAD kernel."""
import copy
import json
import math
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source_digest():
    digest = hashlib.sha256()
    for path in sorted((ROOT / "cad").glob("*")):
        if path.suffix in [".py", ".json"]:
            digest.update(path.name.encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def load(path=None):
    p = json.loads(Path(path or ROOT / "cad/parameters.json").read_text())
    validate(p)
    return p


def validate(p):
    def numbers(value):
        if isinstance(value, dict):
            for item in value.values():
                numbers(item)
        elif isinstance(value, list):
            for item in value:
                numbers(item)
        elif isinstance(value, (float, int)) and not isinstance(value, bool):
            if not math.isfinite(value):
                raise ValueError("Non-finite parameter")
    numbers(p)
    for group, keys in {
        "camera": ["width", "depth", "height", "mass_g"],
        "motor": ["diameter", "depth", "shaft_diameter", "half_steps_per_turn"],
        "base": ["width", "depth", "height", "wall"],
        "pan": ["module", "ring_teeth", "sun_teeth", "planet_teeth", "planet_count", "cable_bore"],
        "tilt": ["motor_teeth","axis_teeth","belt_pitch","belt_length","belt_width"],
    }.items():
        if any(p[group][key] <= 0 for key in keys):
            raise ValueError(f"{group}: positive dimensions required")
    pan, tilt = p["pan"], p["tilt"]
    if any(not float(pan[k]).is_integer() for k in ['sun_teeth','planet_teeth','ring_teeth','planet_count']):
        raise ValueError('Gear and planet counts must be integers')
    if pan['planet_count'] < 2:
        raise ValueError('At least two planets are required')
    if pan['ring_teeth'] != pan['sun_teeth']+2*pan['planet_teeth']:
        raise ValueError('Planetary tooth counts do not share a center distance')
    if (pan['ring_teeth']+pan['sun_teeth']) % pan['planet_count']:
        raise ValueError('Planet count does not allow equally spaced assembly')
    orbit=pan['module']*(pan['sun_teeth']+pan['planet_teeth'])/2
    if 2*orbit*math.sin(math.pi/pan['planet_count']) <= pan['module']*(pan['planet_teeth']+2):
        raise ValueError('Adjacent planet tip circles overlap')
    if pan["sun_teeth"] < 18:
        raise ValueError("Unshifted 20-degree pinion requires at least 18 teeth")
    if pan["cable_bore"] >= pan["bearing_id"] - 4:
        raise ValueError("Insufficient pan-spindle wall around cable passage")
    if p["camera"]["width"] / 2 + p["fit"]["camera_side"] + tilt["cradle_wall"] >= tilt["arm_inner"]:
        raise ValueError("Camera/cradle exceeds the yoke opening")
    if tilt['axis_teeth'] <= tilt['motor_teeth']:
        raise ValueError('Tilt drive requires positive reduction')
    if tilt['motor_z'] >= tilt['axis_z']:
        raise ValueError('Tilt motor must be below the camera axis')
    for name in ["pan", "tilt"]:
        if not p[name]["minimum"] < 0 < p[name]["maximum"]:
            raise ValueError(f"{name}: neutral must be inside the motion limits")
    if any(v <= 0 for v in p["printer"]["bed"]):
        raise ValueError("Invalid printer volume")


def changed(p, group, **values):
    result = copy.deepcopy(p)
    result[group].update(values)
    validate(result)
    return result


def pan_ratio(p):
    return 1 + p["pan"]["ring_teeth"] / p["pan"]["sun_teeth"]


def pan_motor_offset(p):
    return 0.0
