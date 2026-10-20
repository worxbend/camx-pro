"""Sampled involute spur profiles, with explicit internal-gear space construction.

Profiles are prototype approximations, not hob-generated root fillets. Tooth
engagement and print fit require the exported gear coupon and physical trials.
"""
import math
from build123d import Polygon, extrude


def involute(angle):
    return math.tan(angle) - angle


def profile_points(teeth, module, pressure=20, backlash=0.0, internal_space=False, samples=8):
    pitch = module * teeth / 2
    base = pitch * math.cos(math.radians(pressure))
    root = pitch - module * (1 if internal_space else 1.25)
    tip = pitch + module * (1.25 if internal_space else 1)
    half = math.pi / (2 * teeth) + (backlash if internal_space else -backlash) / (2 * pitch)
    reference = involute(math.radians(pressure))

    def half_angle(radius):
        return half + reference - involute(math.acos(min(1.0, base / radius)))

    points = []
    for i in range(teeth):
        center = 2 * math.pi * i / teeth
        radii = [root] + [max(base, root) + (tip - max(base, root)) * j / samples for j in range(samples + 1)]
        radii = list(dict.fromkeys(radii))
        tooth = [(r, center - half_angle(max(r, base))) for r in radii]
        tooth += [(tip, center + half_angle(tip) * t) for t in [-0.5, 0, 0.5]]
        tooth += [(r, center + half_angle(max(r, base))) for r in reversed(radii)]
        next_start = center + 2 * math.pi / teeth - half_angle(max(root, base))
        end = tooth[-1][1]
        tooth += [(root, end + (next_start - end) * t) for t in [0.25, 0.5, 0.75]]
        points.extend((r * math.cos(a), r * math.sin(a)) for r, a in tooth)
    return points


def gear(teeth, module, height, pressure=20, backlash=0.0, internal_space=False):
    points = profile_points(teeth, module, pressure, backlash, internal_space)
    return extrude(Polygon(*points, align=None), amount=height)
