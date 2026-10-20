"""Report candidate interferences; never substitute the report for flexible-harness trials."""
import json
from pathlib import Path
from cad.config import load, source_digest
from cad.assembly import build, transform


def volume(a,b):
    aa,bb=a.bounding_box(),b.bounding_box()
    if any(getattr(aa.max,k) <= getattr(bb.min,k)+1e-6 or
           getattr(bb.max,k) <= getattr(aa.min,k)+1e-6 for k in ["X","Y","Z"]):
        return 0
    overlap=a&b
    return overlap.volume if overlap else 0


def main():
    p=load()
    digest=source_digest()
    components,_=build(p)
    items=[c for c in components.values() if c.group!="coupon"]
    collisions=[]
    for i,a in enumerate(items):
        for b in items[i+1:]:
            overlap=volume(a.shape,b.shape)
            if overlap>.05:
                collisions.append({"a":a.name,"b":b.name,"volume_mm3":round(overlap,3)})
    for pair in collisions:
        print(pair,flush=True)
    out=Path("exports/reports")
    out.mkdir(parents=True,exist_ok=True)
    assert digest == source_digest()
    result = {"status": "failed" if collisions else "passed",
              "cad_source_sha256": digest, "pose": {"pan": 0, "tilt": 0},
              "threshold_mm3": .05, "failures": collisions,
              "limitations": ["Neutral rigid pose only; see motion and cable reports."]}
    (out/"interferences.json").write_text(json.dumps(result,indent=2)+"\n")
    print(f"{len(collisions)} neutral interference candidates",flush=True)
    raise SystemExit(bool(collisions))


if __name__=="__main__":
    main()
