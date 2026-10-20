"""Generate drawings and engineering renders from the exported CAD geometry."""
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from build123d import Compound
from cad.assembly import build
from cad.config import load

OUT = Path("exports")


def drawing(items, name, origin, up=(0, 0, 1)):
    shapes = [c.shape for c in items if c.group != "coupon"]
    visible, _ = Compound(children=shapes).project_to_viewport(origin, up, (0, 0, 70))
    fig, ax = plt.subplots(figsize=(11.7, 8.3))
    all_points = []
    for edge in visible:
        points = np.array([list(edge.position_at(float(t)))[:2] for t in np.linspace(0, 1, 25)])
        ax.plot(points[:, 0], points[:, 1], color="#253b35", linewidth=.45)
        all_points.extend(points)
    points = np.array(all_points)
    low, high = points.min(axis=0), points.max(axis=0)
    for dim in [0, 1]:
        other = 1 - dim
        a, b = low.copy(), high.copy()
        a[other] = b[other] = low[other] - 14
        ax.annotate("", b, a, arrowprops={"arrowstyle": "<->", "lw": .6})
        mid = (a + b) / 2
        ax.text(*mid, f" {high[dim]-low[dim]:.1f} mm ", fontsize=9,
                rotation=0 if dim == 0 else 90, ha="center", va="center",
                bbox={"facecolor": "white", "edgecolor": "none", "pad": 1})
    ax.set_aspect("equal")
    ax.set_xlim(low[0]-35, high[0]+20)
    ax.set_ylim(low[1]-30, high[1]+15)
    ax.axis("off")
    fig.text(.07, .94, f"CAMX PRO / {name.upper()} / P3", fontsize=17, weight="bold")
    fig.text(.07, .065, "mm · Orthographic · Dimensions from nominal CAD · Do not scale drawing\n"
             "Hardware envelope provisional. Full part geometry: matching STEP files. Physical fits unqualified.",
             fontsize=9)
    fig.savefig(OUT / "drawings" / f"{name}.svg")
    fig.savefig(OUT / "drawings" / f"{name}.pdf")
    fig.savefig(OUT / "drawings" / f"{name}.png", dpi=180)
    plt.close(fig)


def main():
    from tools.render import render as depth_render
    p = load()
    components, _ = build(p)
    items = list(components.values())
    for d in ["images", "drawings"]:
        (OUT / d).mkdir(parents=True, exist_ok=True)
    for name, az, el, extras in [
        ("three_quarter", -55, 22, {}),
        ("front", -90, 0, {}), ("side", 0, 0, {}), ("rear", 90, 12, {}),
        ("pan_120", -55, 22, {"pan": 120}),
        ("tilt_75", -55, 22, {"tilt": 75}),
        ("exploded", -55, 24, {"exploded": True}),
        ("cutaway", -55, 24, {"cutaway": True}),
        ("electronics", -55, 65, {"electronics": True}),
    ]:
        depth_render(items, p, name, az, el, **extras)
        print(f"Rendered {name}", flush=True)
    actuator=[c for c in items if (c.name.startswith('planetary_') and c.name!='planetary_carrier_upper')
              or c.name.startswith('planet_') or c.name.startswith('pan_motor')]
    depth_render(actuator,p,'planetary_actuator',-55,50,target_height=30,half_size=68)
    print('Rendered planetary actuator',flush=True)
    # Hidden-line computation uses the exact B-rep, not a concept image.
    for name, origin, up in [
        ("front", (0, -1000, 70), (0, 0, 1)),
        ("side", (1000, 0, 70), (0, 0, 1)),
        ("rear", (0, 1000, 70), (0, 0, 1)),
        ("top", (0, 0, 1000), (0, 1, 0)),
        ("bottom", (0, 0, -1000), (0, -1, 0)),
    ]:
        drawing(items, name, origin, up)
        print(f"Drawing {name}", flush=True)


if __name__ == "__main__":
    main()
