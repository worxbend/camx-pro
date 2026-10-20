"""Parameter propagation and explicitly assumed gravity/step-rate scenarios."""
import copy
import json
import math
from pathlib import Path

import trimesh

from cad.config import load, pan_ratio, source_digest
from cad.enclosure import build_enclosure
from cad.planetary import build_actuator


def main():
    p = load()
    assert p["revision"] == "p3", "Review the P3 interface assumptions before using this probe"
    digest = source_digest()
    manifest = json.loads(Path("exports/manifest.json").read_text())
    assert manifest["cad_source_sha256"] == digest
    baseline = build_actuator(p)
    changed = copy.deepcopy(p)
    changed["fit"]["bearing_diametral"] += .2
    altered = build_actuator(changed)
    fit_deltas = {n: altered[n].volume-baseline[n].volume for n in baseline}
    changed = copy.deepcopy(p)
    changed["base"]["wall"] += 1
    bonnet_delta = build_enclosure(changed)[1].volume-build_enclosure(p)[1].volume
    cradle = trimesh.load_mesh("exports/parts/camera_cradle.stl", process=True)
    # This part has zero print rotation: recover its assembly-space COM from
    # the stored AABB translation, without assuming STL coordinates are CAD coordinates.
    bounds = manifest["parts"]["camera_cradle"]["bounds"]
    assembly_com = cradle.center_mass + [
        (bounds[0][0]+bounds[1][0])/2,
        (bounds[0][1]+bounds[1][1])/2,
        bounds[0][2],
    ]
    density = 1.25  # scenario in g/cm³, not a measured filament specification
    cradle_mass_kg = cradle.volume/1000*density/1000
    radius = math.hypot(assembly_com[1], assembly_com[2]-p["tilt"]["axis_z"])/1000
    cradle_gravity = cradle_mass_kg*9.80665*radius
    tilt_ratio = p["tilt"]["axis_teeth"]/p["tilt"]["motor_teeth"]
    scenarios = []
    for offset_mm in [2,5,10,20]:
        gravity = p["camera"]["mass_g"]/1000*9.80665*offset_mm/1000+cradle_gravity
        scenarios.append({
            "camera_radial_cg_offset_mm": offset_mm,
            "conservative_gravity_output_Nm": gravity,
            "required_motor_Nm_at_efficiency_0_75_and_margin_2": 2*gravity/(tilt_ratio*.75),
            "required_motor_Nm_at_efficiency_0_50_and_margin_2": 2*gravity/(tilt_ratio*.5),
        })
    rates = {}
    for name, ratio in [("pan",pan_ratio(p)),("tilt",tilt_ratio)]:
        speed = p["motion"][name+"_speed"]
        rate = speed/360*ratio*p["motor"]["half_steps_per_turn"]
        rates[name] = {"axis_speed_degrees_s": speed, "external_reduction": ratio,
                       "motor_half_steps_s": rate,
                       "below_configured_software_limit": rate <= p["motion"]["maximum_step_rate"],
                       "ideal_full_travel_seconds_without_acceleration":
                           (p[name]["maximum"]-p[name]["minimum"])/speed}
    fit_ignored = all(abs(delta) < 1e-6 for delta in fit_deltas.values())
    wall_ignored = abs(bonnet_delta) < 1e-6
    result = {
        "status": "blocked" if fit_ignored or wall_ignored else "hardware_qualification_pending",
        "cad_source_sha256": digest,
        "parameter_propagation": {
            "bearing_clearance_increase_mm": .2,
            "actuator_volume_changes_mm3": fit_deltas,
            "base_wall_increase_mm": 1, "bonnet_volume_change_mm3": bonnet_delta,
            "bearing_clearance_ignored_by_actuator": fit_ignored,
            "wall_parameter_ignored_by_bonnet": wall_ignored,
        },
        "load_assumptions": {
            "camera_mass_g": p["camera"]["mass_g"], "density_scenario_g_cm3": density,
            "cradle_full_solid_mass_g": cradle_mass_kg*1000,
            "cradle_assembly_center_of_mass_mm": assembly_com.tolist(),
            "cradle_gravity_torque_upper_bound_Nm": cradle_gravity,
            "cradle_volume_source": "exported STL; full solid, not actual infill mass",
        },
        "tilt_gravity_scenarios": scenarios, "step_rate_budget": rates,
        "limitations": [
            "Gravity scenario only: excludes cable drag, bearing friction, acceleration and purchased moving hardware.",
            "The sum of radial moment magnitudes is conservative for the included camera and cradle only.",
            "Camera mass is approximate manufacturer data; density, CG and efficiency are assumptions.",
            "No verified motor running-torque curve; this cannot qualify either motor under load.",
            "Software rate comparison does not prove firmware timing or achievable mechanical speed.",
            "No FEA/strength/tipping qualification without measured loads, material and support conditions.",
        ],
    }
    assert digest == source_digest()
    target = Path("exports/reports/preprint")
    target.mkdir(parents=True,exist_ok=True)
    (target/"parameters-and-loads.json").write_text(json.dumps(result,indent=2)+"\n")
    print("Bearing fit parameter propagation:", max(abs(v) for v in fit_deltas.values()), "mm³")
    print("Base wall parameter propagation:", bonnet_delta, "mm³")
    for row in scenarios:
        print(row)
    print(f"Result: {result['status']}; motor/load qualification pending.")
    raise SystemExit(result["status"] == "blocked")


if __name__ == "__main__":
    main()
