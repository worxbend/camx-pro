"""Headless depth-buffered CAD renderer (EGL); no browser or concept geometry."""
import math
from pathlib import Path
import moderngl
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from matplotlib.colors import to_rgb
from cad.assembly import transform


def unit(v):
    return v / np.linalg.norm(v)


def render(items, p, name, azimuth=-55, elevation=22, pan=0, tilt=0,
           exploded=False, cutaway=False, electronics=False, target_height=None, half_size=None):
    ctx = moderngl.create_standalone_context(backend="egl")
    size = (1800, 1500)
    frame = ctx.simple_framebuffer(size, components=4)
    frame.use()
    frame.clear(.91, .93, .91, 1)
    ctx.enable(moderngl.DEPTH_TEST | moderngl.BLEND)
    ctx.blend_func = moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA
    program = ctx.program(vertex_shader="""
        #version 330
        uniform mat4 mvp;
        in vec3 position; in vec3 normal; in vec4 color;
        out vec3 point; out vec3 surface; out vec4 paint;
        void main(){ point=position; surface=normal; paint=color;
                     gl_Position=mvp*vec4(position,1); }
        """, fragment_shader="""
        #version 330
        uniform vec3 eye;
        in vec3 point; in vec3 surface; in vec4 paint; out vec4 pixel;
        void main(){
          vec3 n=normalize(surface),v=normalize(eye-point);
          if(dot(n,v)<0) n=-n;
          vec3 light=normalize(vec3(-.6,-.7,1));
          float diffuse=max(dot(n,light),0);
          float rim=max(dot(n,normalize(vec3(1,.6,.6))),0);
          float spec=pow(max(dot(n,normalize(light+v)),0),32)*.06;
          vec3 c=paint.rgb*(.42+.72*diffuse+.3*rim)+spec;
          pixel=vec4(c,paint.a);
        }""")
    target = np.array([0., 0., target_height if target_height is not None else (140. if exploded else 90.)])
    az, el = math.radians(azimuth), math.radians(elevation)
    eye = target+420*np.array([math.cos(el)*math.cos(az), math.cos(el)*math.sin(az), math.sin(el)])
    forward = unit(target-eye)
    right = unit(np.cross(forward, [0, 0, 1]))
    up = np.cross(right, forward)
    view = np.eye(4); view[:3, :3] = [right, up, -forward]
    view[:3, 3] = -view[:3, :3]@eye
    half = half_size if half_size is not None else (215 if exploded else 145)
    projection = np.diag([1/(half*size[0]/size[1]), 1/half, -2/1000, 1])
    projection[2, 3] = -1
    program["mvp"].write((projection@view).astype("f4").T.tobytes())
    program["eye"].value = tuple(eye)
    shells = {"base_shell", "base_lid", "base_service_hatch",
              "yoke_cover_drive", "yoke_cover_passive", "rear_drive_cover"}
    # Transparent enclosure surfaces follow opaque parts.
    order = sorted(items, key=lambda c: cutaway and c.name in shells)
    for c in order:
        if c.group == "coupon" or (electronics and (c.group in ["pan", "tilt", "tilt_drive"] or c.name in shells)):
            continue
        shape = transform(c, p, pan, tilt)
        vertices, faces = shape.tessellate(.16, .14)
        vertices = np.array([list(v) for v in vertices])
        if exploded:
            if c.group == "pan":
                vertices += [np.sign(vertices[:, 0].mean())*20, 0, 45]
            elif c.group == "tilt":
                vertices += [0, 0, 100]
            elif c.name in ["base_lid", "base_service_hatch"]:
                vertices += [0, 0, -30]
        tri = vertices[np.asarray(faces)]
        face_normals = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
        normals = np.zeros_like(vertices)
        for k in range(3):
            np.add.at(normals,np.asarray(faces)[:,k],face_normals)
        normals /= np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-9)
        normals = normals[np.asarray(faces)].reshape(-1,3)
        alpha = .14 if cutaway and c.name in shells else 1.
        color = np.array([*to_rgb(c.color), alpha])
        data = np.column_stack((tri.reshape(-1, 3), normals,
                                np.tile(color, (tri.size//3, 1)))).astype("f4")
        buffer = ctx.buffer(data.tobytes())
        vao = ctx.vertex_array(program, [(buffer, "3f 3f 4f", "position", "normal", "color")])
        ctx.depth_mask = alpha == 1
        vao.render(moderngl.TRIANGLES)
        vao.release(); buffer.release()
    image = Image.frombytes("RGBA", size, frame.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    draw = ImageDraw.Draw(image)
    draw.text((100, 80), f"CAMX PRO / {p['revision'].upper()}", fill="#263c34", font=ImageFont.load_default(size=45))
    draw.text((100, 145), name.replace("_", " ").upper(), fill="#52655c", font=ImageFont.load_default(size=24))
    draw.text((100, 1400), "ACTUAL CAD / PROVISIONAL HARDWARE / FIT QUALIFICATION PENDING",
              fill="#52655c", font=ImageFont.load_default(size=22))
    image.convert("RGB").save(Path("exports/images")/f"{name}.png")
    ctx.release()
