"""Removable PCB trays with clearance walls, underside tie slots and screw ears.

The populated board envelopes remain provisional. Use nonconductive ties with
padding on verified bare board edges; do not tighten across components.
"""
from .geometry import box, cylinder


def layout(p):
    e=p['electronics']
    return {
        'esp32':(-55,-12,29,58,14,7),
        'driver_pan':(55,-24,32,35,14,7),
        'driver_tilt':(55,24,32,35,14,7),
        'integration_pcb':(0,-40,e['integration'][0],e['integration'][1],e['integration'][2],7),
        'usb_power':(36,66,18,12,5,27),
    }


def build_trays(p,chassis):
    parts={};ties={}
    for name,(x,y,w,l,h,z) in layout(p).items():
        plate=box(w+5,l+1,3,x,y,z-3)
        for side in [-1,1]:
            plate+=box(2,l+1,2,x+side*(w/2+1.5),y,z)
        for yy in [-l/4,l/4]:
            plate-=box(w+8,3.8,1.6,x,y+yy,z-3.1)
            height=h+3.8
            strap=box(w+8,3,height,x,y+yy,z-2.7)-box(w+6.8,5,height-1.2,x,y+yy,z-2.1)
            ties[f'{name}_tie_{"a" if yy<0 else "b"}']=strap
        if name=='usb_power':
            plate+=box(w+5,7,3,x,y-9,z-3)
            for xx in [-7,7]:
                plate+=cylinder(7,z-4,x+xx,y-10,4)
                plate-=cylinder(2.3,z-2,x+xx,y-10,3)
                chassis-=cylinder(1.8,4,x+xx,y-10,.5)
        else:
            for yy in [-l/2-3,l/2+3]:
                plate+=cylinder(6,3,x,y+yy,z-3)
                plate-=cylinder(2.3,5,x,y+yy,z-4)
                chassis-=cylinder(1.8,4,x,y+yy,.5)
        # Straps have uninterrupted clearance beside the tray and through its underside.
        for yy in [-l/4,l/4]:
            plate-=ties[f'{name}_tie_{"a" if yy<0 else "b"}']
        parts[name+'_tray']=plate
    # Capacitor retained by a cup and a vertical insulating tie through two slots.
    x,y=29,-59
    cup=cylinder(15,3,x,y,4)+cylinder(15,8,x,y,7)
    cup-=cylinder(p['electronics']['capacitor'][0]+.6,9,x,y,7)
    cup-=box(18,3.8,1.6,x,y,3.9)
    cup-=box(20,3.8,9,x,y,6.5)
    # Preserve the cup as one solid through its uncut 1.5 mm floor.
    for yy in [-10,10]:
        cup+=cylinder(7,3,x,y+yy,4)
        cup-=cylinder(2.3,5,x,y+yy,3)
        chassis-=cylinder(1.8,4,x,y+yy,.5)
    ties['capacitor_tie']=box(18,3,23.5,x,y,4.3)-box(16.8,5,22.3,x,y,4.9)
    cup-=box(26,3.8,1.6,x,y,3.9)
    # Keep a bridge below the under-floor strap tunnel and beside it.
    parts["capacitor_cradle"]=cup
    return chassis,parts,ties
