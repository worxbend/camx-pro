"""Additional sampled tooth-profile and local tilt checks for the preprint audit."""
import itertools
import json
import math
from pathlib import Path

from build123d import Pos
from shapely import affinity
from shapely.geometry import Point, Polygon

from cad.assembly import build, transform
from cad.config import load, pan_ratio, source_digest
from cad.transmissions import profile_points
from cad.tilt_drive import drive_datums
from tools.check_interference import volume


def gear_sweep(p, increment=.25):
    g = p["pan"]
    kwargs = dict(module=g["module"], pressure=g["pressure_angle"], backlash=g["backlash"]/2)
    sun = Polygon(profile_points(g["sun_teeth"], **kwargs))
    planet = Polygon(profile_points(g["planet_teeth"], **kwargs))
    space = affinity.rotate(Polygon(profile_points(g["ring_teeth"], internal_space=True,
                                                   **kwargs)),
                            180/g["ring_teeth"], origin=(0, 0))
    ring = Point(0, 0).buffer(47, quad_segs=128).difference(space)
    assert all(s.is_valid for s in [sun, planet, ring])
    orbit = g["module"]*(g["sun_teeth"]+g["planet_teeth"])/2
    ratio = pan_ratio(p)
    relative_ratio = -g["sun_teeth"]/g["planet_teeth"]*(ratio-1)
    peak, minimum = 0.0, math.inf
    failures, checks = [], 0
    for step in range(round(360/increment)+1):
        theta = step*increment
        sun_now = affinity.rotate(sun, ratio*theta, origin=(0, 0))
        for i in range(g["planet_count"]):
            angle = i*360/g["planet_count"]
            phase = angle*(1+g["sun_teeth"]/g["planet_teeth"])+180/g["planet_teeth"]
            wheel = affinity.rotate(planet, phase+(1+relative_ratio)*theta, origin=(0, 0))
            wheel = affinity.translate(wheel, orbit*math.cos(math.radians(angle+theta)),
                                       orbit*math.sin(math.radians(angle+theta)))
            for label, target in [("sun", sun_now), ("ring", ring)]:
                overlap = wheel.intersection(target).area
                peak = max(peak, overlap)
                minimum = min(minimum, wheel.distance(target))
                checks += 1
                if overlap > 1e-6:
                    failures.append({"angle": theta, "planet": i, "pair": label,
                                     "overlap_mm2": overlap})
    return {"status": "failed" if failures else "passed",
            "carrier_step_degrees": increment, "carrier_range_degrees": [0, 360],
            "profile_pair_checks": checks, "peak_overlap_mm2": peak,
            "minimum_sampled_profile_gap_mm": minimum, "failures": failures,
            "adjacent_planet_tip_circle_gap_mm":
                2*orbit*math.sin(math.pi/g["planet_count"])-g["module"]*(g["planet_teeth"]+2)}


def tilt_sweep(p, components):
    moving = [c for c in components.values() if c.group in {"tilt", "tilt_drive"}]
    stationary = [c for c in components.values() if c.group == "pan"]
    checks, failures, peak = 0, [], 0.0
    d=drive_datums(p);roll=math.radians(d['motor_roll'])
    adjusted=[(shift,name,Pos(0,shift*math.cos(roll),shift*math.sin(roll))*components[name].shape)
              for shift in [-1,1] for name in ['tilt_motor','rear_drive_cover']]
    for angle in range(int(p["tilt"]["minimum"]), int(p["tilt"]["maximum"])+1):
        for a, b in itertools.product(moving, stationary):
            overlap = volume(transform(a, p, tilt=angle), b.shape)
            peak = max(peak, overlap)
            checks += 1
            if overlap > .05:
                failures.append({"tilt": angle, "a": a.name, "b": b.name,
                                 "overlap_mm3": overlap})
        for shift,name,target in adjusted:
            for camera_part in ['camera','camera_cradle','camera_plug']:
                overlap=volume(transform(components[camera_part],p,tilt=angle),target)
                checks+=1;peak=max(peak,overlap)
                if overlap>.05:
                    failures.append(dict(tilt=angle,motor_adjustment_mm=shift,a=camera_part,b=name,overlap_mm3=overlap))
        # Different driven ratios can produce relative interference too.
        for a, b in itertools.combinations(moving, 2):
            if a.group == b.group:
                continue
            overlap = volume(transform(a, p, tilt=angle), transform(b, p, tilt=angle))
            peak = max(peak, overlap)
            checks += 1
            if overlap > .05:
                failures.append({"tilt": angle, "a": a.name, "b": b.name,
                                 "overlap_mm3": overlap})
        if angle % 15 == 0:
            print(f"Tilt {angle}°: {len(failures)} nominal intersections", flush=True)
    return {"status": "failed" if failures else "passed", "angle_step_degrees": 1,
            "pair_checks": checks, "peak_overlap_mm3": peak, "threshold_mm3": .05,
            "failures": failures}


def main():
    p = load()
    digest = source_digest()
    gears = gear_sweep(p)
    print(f"Tooth profiles: {gears['profile_pair_checks']} pairs; {gears['status']}", flush=True)
    components, _ = build(p)
    tilt = tilt_sweep(p, components)
    # Conservative continuous lower-Z bound from each tilted rigid body's AABB.
    # Pan cannot change Z. This does not cover wire loops or unmodeled hardware.
    axis = p["tilt"]["axis_z"]
    lower_bounds = {}
    for c in components.values():
        if c.group == "tilt":
            bounds = c.shape.bounding_box()
            radius = max(math.hypot(y, z-axis) for y in [bounds.min.Y, bounds.max.Y]
                         for z in [bounds.min.Z, bounds.max.Z])
            lower_bounds[c.name] = axis-radius
    result = {"cad_source_sha256": digest,
              "status": "passed" if gears["status"] == tilt["status"] == "passed" else "failed",
              "gears": gears, "tilt": tilt,
              "continuous_all_tilt_angles_lower_z_bounds_mm": lower_bounds,
              "fixed_enclosure_top_z_mm": components["base_lid"].shape.bounding_box().max.Z,
              "limitations": [
                  "Gear profiles are the same sampled involutes used by CAD, not generated-tool contact analysis.",
                  "Nominal dimensions only; no tolerances, deflection, tooth strength or backlash prediction.",
                  "Finite angle sampling cannot prove clearance between samples.",
                  "Fasteners, cable compliance, tension adjustment and loaded stacks checked separately.",
                  "Lower-Z bound only excludes base contact for listed bodies; it does not prove other clearances.",
              ]}
    assert digest == source_digest()
    output = Path("exports/reports/preprint")
    output.mkdir(parents=True, exist_ok=True)
    (output / "dense-motion.json").write_text(json.dumps(result, indent=2)+"\n")
    raise SystemExit(result["status"] != "passed")


if __name__ == "__main__":
    main()
