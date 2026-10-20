/** UI simulator only; the C++ controller fixture verifies real firmware semantics. */
export function initialState() {
  return {
    api: 1,
    result: 'ok',
    epoch: 100,
    seq: 0,
    armed: false,
    referenced: false,
    stopped: false,
    moving: false,
    jogging: false,
    commissioned: false,
    storage_ok: true,
    settings_dirty: false,
    fault: 'none',
    max_tick_gap_us: 0,
    timing_faults: 0,
    axes: [4, 2].map((reduction, i) => ({
      degrees: 0,
      target: 0,
      steps: 0,
      velocity: 0,
      motor_steps: 4096,
      reduction,
      minimum: i ? -15 : -20,
      maximum: i ? 15 : 20,
      speed: 4,
      acceleration: 8,
      inverted: false,
    })),
    presets: Array.from({ length: 8 }, () => ({ valid: false, pan: 0, tilt: 0 })),
  };
}
export function demoTransport(now = () => performance.now()) {
  const s = initialState();
  let previous = now(),
    heartbeat = now(),
    lease = now(),
    vector = null;
  const rotate = () => {
    s.epoch++;
    s.seq = 0;
  };
  const halt = () => {
    if (s.moving) s.referenced = false;
    s.stopped = true;
    s.moving = s.jogging = false;
    vector = null;
    rotate();
  };
  return async (command) => {
    const time = now(),
      elapsed = Math.min((time - previous) / 1000, 1);
    previous = time;
    if (s.armed && time - heartbeat > 5000) halt();
    if (vector && time - lease > 500) {
      vector = null;
      s.jogging = false;
      s.axes.forEach((a) => (a.target = a.degrees));
    }
    s.axes.forEach((a, i) => {
      if (vector)
        a.target = Math.max(
          a.minimum,
          Math.min(a.maximum, a.degrees + vector[i] * a.speed * elapsed),
        );
      const delta = Math.max(-a.speed * elapsed, Math.min(a.speed * elapsed, a.target - a.degrees));
      a.degrees += delta;
      a.steps = Math.round((a.degrees * a.motor_steps * a.reduction) / 360);
      a.velocity = elapsed ? delta / elapsed : 0;
    });
    s.moving = !!vector || s.axes.some((a) => Math.abs(a.target - a.degrees) > 0.001);
    s.result = 'ok';
    const c = command;
    if (c?.op === 'stop') {
      halt();
      s.axes.forEach((a) => (a.target = a.degrees));
    } else if (c) {
      if (c.epoch !== s.epoch || c.seq <= s.seq) s.result = 'stale';
      else {
        s.seq = c.seq;
        switch (c.op) {
          case 'heartbeat':
            heartbeat = time;
            break;
          case 'reference':
            if (s.armed) {
              s.result = 'busy';
              break;
            }
            if (
              ![c.pan, c.tilt].every(
                (v, i) => Number.isFinite(v) && v >= s.axes[i].minimum && v <= s.axes[i].maximum,
              )
            ) {
              s.result = 'range';
              break;
            }
            s.axes.forEach((a, i) => (a.target = a.degrees = [c.pan, c.tilt][i]));
            s.referenced = true;
            s.stopped = false;
            rotate();
            break;
          case 'arm':
            if (!s.referenced || s.stopped) s.result = 'not_referenced';
            else {
              s.armed = true;
              heartbeat = time;
            }
            break;
          case 'disarm':
            s.armed = s.referenced = s.moving = s.jogging = false;
            vector = null;
            s.axes.forEach((a) => (a.target = a.degrees));
            rotate();
            break;
          case 'preset_set':
            if (s.armed) s.result = 'busy';
            else s.presets[c.slot] = { valid: true, pan: c.pan, tilt: c.tilt };
            break;
          case 'settings':
            if (s.armed) {
              s.result = 'busy';
              break;
            }
            for (const [i, axis] of ['pan', 'tilt'].entries())
              for (const [key, name] of [
                ['speed', 'speed'],
                ['accel', 'acceleration'],
              ])
                if (c[`${axis}_${key}`] !== undefined) s.axes[i][name] = c[`${axis}_${key}`];
            s.referenced = false;
            rotate();
            break;
          default: {
            if (!s.armed || s.stopped || !s.referenced) {
              s.result = 'not_armed';
              break;
            }
            const braking = c.op === 'jog' && c.pan === 0 && c.tilt === 0;
            if (
              s.moving &&
              !braking &&
              !(c.op === 'jog' && vector?.[0] === c.pan && vector?.[1] === c.tilt)
            ) {
              s.result = 'busy';
              break;
            }
            if (c.op === 'jog') {
              vector = braking ? null : [c.pan, c.tilt];
              lease = time;
              s.jogging = !!vector;
              s.moving = !!vector;
              s.axes.forEach((a) => (a.target = a.degrees));
              break;
            }
            const p = c.op === 'preset_move' ? s.presets[c.slot] : null;
            const target =
              c.op === 'center'
                ? [0, 0]
                : p
                  ? [p.pan, p.tilt]
                  : s.axes.map(
                      (a, i) => [c.pan, c.tilt][i] + (c.op === 'relative' ? a.degrees : 0),
                    );
            if (
              (p && !p.valid) ||
              !target.every(
                (v, i) => Number.isFinite(v) && v >= s.axes[i].minimum && v <= s.axes[i].maximum,
              )
            ) {
              s.result = 'range';
              break;
            }
            s.axes.forEach((a, i) => (a.target = target[i]));
            s.moving = true;
          }
        }
      }
    }
    return structuredClone(s);
  };
}
