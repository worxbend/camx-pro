"""Sample rigid geometry at target poses; cable compliance remains a bench test."""
import argparse
import itertools
import json
from pathlib import Path
from cad.assembly import build, transform
from cad.config import load, source_digest
from tools.check_interference import volume


def relative_pose_key(a, b, pan, tilt):
    """Cancel common rigid transforms without approximating either solid."""
    groups = {a.group, b.group}
    if len(groups) == 1:
        return ()
    if groups <= {"pan", "tilt", "tilt_drive"}:
        return (tilt,)
    if not groups.intersection({"tilt", "tilt_drive"}):
        return (pan,)
    return (pan, tilt)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--fail-fast",action="store_true")
    args=ap.parse_args()
    p = load()
    digest = source_digest()
    components, _ = build(p)
    items = [c for c in components.values() if c.group != "coupon"]
    pairs = list(itertools.combinations(items, 2))
    poses = [(pan, 0) for pan in range(-160, 161, 10)]
    poses += [(0, tilt) for tilt in range(-30, 91, 5) if tilt != 0]
    poses += list(itertools.product([-160, -80, 80, 160], [-30, 45, 90]))
    failures = []
    checked = 0
    reused = 0
    cache = {}
    completed=[]
    for pan, tilt in poses:
        shapes = {c.name: transform(c, p, pan, tilt) for c in items}
        for a, b in pairs:
            key = (a.name, b.name, relative_pose_key(a, b, pan, tilt))
            if key in cache:
                v = cache[key]
                reused += 1
            else:
                v = volume(shapes[a.name], shapes[b.name])
                cache[key] = v
                checked += 1
            if v > .05:
                if len(failures)<5:print("Interference:",pan,tilt,a.name,b.name,round(v,5),flush=True)
                failures.append({"pan": pan, "tilt": tilt, "a": a.name,
                                 "b": b.name, "overlap_mm3": round(v, 3)})
        completed.append((pan,tilt))
        print(f"Pose {pan:4} / {tilt:3}: {len(failures)} conflicts", flush=True)
        if failures and args.fail_fast:break
    result = {"status": "failed" if failures else "passed", "poses": completed,"planned_poses":poses,
              "cad_source_sha256": digest,
              "pair_checks": checked, "rigid_invariance_reuses": reused,
              "threshold_mm3": .05, "failures": failures,
              "limitations": [
                  "Finite samples, not continuous collision proof.",
                  "Hardware is provisional simplified envelopes; fastener envelopes and prescribed cable tubes are checked separately.",
                  "Timing belt and pulleys omit teeth; no belt engagement or pretension validation.",
                  "No load, physical clearance, gear durability, or cable sweep qualification."
              ]}
    output = Path("exports/reports")
    output.mkdir(parents=True, exist_ok=True)
    assert digest == source_digest(), "CAD source changed during validation"
    (output / "motion.json").write_text(json.dumps(result, indent=2) + "\n")
    raise SystemExit(bool(failures))


if __name__ == "__main__":
    main()
