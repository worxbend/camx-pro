"""Stationary enclosure and the modular planetary pan actuator."""
from .enclosure import build_enclosure
from .planetary import build_actuator
from .electronics import build_trays
from .cables import build_guides


def build_base(p):
    shell,lid,hatch,clamps=build_enclosure(p)
    shell,trays,_=build_trays(p,shell)
    shell,guides=build_guides(p,shell,trays.values())
    return {'base_shell':shell,'base_lid':lid,'base_service_hatch':hatch,
            **build_actuator(p),**clamps,**trays,**guides}
