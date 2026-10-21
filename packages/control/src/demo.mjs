/** UI simulator only; the C++ controller fixture verifies real firmware semantics. */
const names = /^[\x20\x21\x23-\x5b\x5d-\x7e]{0,16}$/; // printable ASCII except " and \
const scale = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0.05 && n <= 1;

export function initialState() {
  return {
    api: 1,
    api_minor: 1,
    result: 'ok',
    epoch: 100,
    seq: 0,
    armed: false,
    referenced: false,
    stopped: false,
    moving: false,
    jogging: false,
    queued: false,
    commissioned: false,
    storage_ok: true,
    settings_dirty: false,
    fault: 'none',
    eta: 0,
    motion: { speed: 1, accel: 1, jerk: 1 },
    max_tick_gap_us: 0,
    max_tick_cost_us: 0,
    timing_faults: 0,
    last_pose: { valid: false, pan: 0, tilt: 0 },
    axes: [4, 2].map((reduction, i) => ({
      degrees: 0,
      target: 0,
      steps: 0,
      velocity: 0,
      accel_now: 0,
      motor_steps: 4096,
      reduction,
      minimum: i ? -15 : -20,
      maximum: i ? 15 : 20,
      speed: 4,
      acceleration: 8,
      jerk: 80,
      inverted: false,
    })),
    presets: Array.from({ length: 8 }, () => ({ valid: false, pan: 0, tilt: 0, name: '' })),
  };
}

// Positions move at constant rates (no acceleration or jerk is simulated). Position moves are
// synchronized like the firmware's: both axes finish together, so diagonals are straight.
export function demoTransport(now = () => performance.now()) {
  const s = initialState();
  let previous = now(),
    heartbeat = now(),
    lease = now(),
    vector = null,
    rates = [0, 0];
  const rotate = () => {
    s.epoch++;
    s.seq = 0;
  };
  const halt = () => {
    if (s.moving) s.referenced = false;
    s.stopped = true;
    s.moving = s.jogging = s.queued = false;
    vector = null;
    rotate();
  };
  const inRange = (values) =>
    values.every((v, i) => Number.isFinite(v) && v >= s.axes[i].minimum && v <= s.axes[i].maximum);
  const begin = (target, speed) => {
    const top = s.axes.map((a) => a.speed * s.motion.speed * speed);
    const time = Math.max(...s.axes.map((a, i) => Math.abs(target[i] - a.degrees) / top[i]));
    s.axes.forEach((a, i) => {
      a.target = target[i];
      rates[i] = time > 0 ? Math.abs(target[i] - a.degrees) / time : 0;
    });
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
      if (vector) {
        rates[i] = Math.abs(vector[i]) * a.speed * s.motion.speed;
        a.target = Math.max(
          a.minimum,
          Math.min(a.maximum, a.degrees + vector[i] * a.speed * s.motion.speed * elapsed),
        );
      }
      const step = rates[i] * elapsed;
      const delta = Math.max(-step, Math.min(step, a.target - a.degrees));
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
            if (!inRange([c.pan, c.tilt])) {
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
            if (s.referenced && !s.moving)
              s.last_pose = { valid: true, pan: s.axes[0].degrees, tilt: s.axes[1].degrees };
            else s.last_pose = { valid: false, pan: 0, tilt: 0 };
            s.armed = s.referenced = s.moving = s.jogging = s.queued = false;
            vector = null;
            s.axes.forEach((a) => (a.target = a.degrees));
            rotate();
            break;
          case 'motion': {
            const keys = ['speed', 'accel', 'jerk'].filter((k) => c[k] !== undefined);
            if (!keys.length) s.result = 'invalid';
            else if (!keys.every((k) => scale(c[k]))) s.result = 'range';
            else keys.forEach((k) => (s.motion[k] = c[k]));
            break;
          }
          case 'preset_set':
          case 'preset_save': {
            const old = s.presets[c.slot];
            if (!old || (c.name !== undefined && !names.test(c.name))) {
              s.result = 'invalid';
              break;
            }
            if (c.op === 'preset_set' && s.armed) {
              s.result = 'busy';
              break;
            }
            if (c.op === 'preset_save' && !s.referenced) {
              s.result = 'not_referenced';
              break;
            }
            if (c.op === 'preset_save' && s.moving) {
              s.result = 'busy';
              break;
            }
            const [pan, tilt] =
              c.op === 'preset_save' ? s.axes.map((a) => a.degrees) : [c.pan, c.tilt];
            if (!inRange([pan, tilt])) {
              s.result = 'range';
              break;
            }
            const name = c.name ?? (old.valid ? old.name : '');
            s.presets[c.slot] = { valid: true, pan, tilt, name };
            break;
          }
          case 'preset_clear':
            if (!s.presets[c.slot]) s.result = 'invalid';
            else s.presets[c.slot] = { valid: false, pan: 0, tilt: 0, name: '' };
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
                ['jerk', 'jerk'],
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
            const renewal = c.op === 'jog' && vector?.[0] === c.pan && vector?.[1] === c.tilt;
            const retarget = c.op !== 'jog' && c.retarget === true;
            if (s.moving && !braking && !renewal && !(retarget && !vector)) {
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
            const speed = c.speed ?? 1;
            if (!scale(speed)) {
              s.result = 'range';
              break;
            }
            const p = c.op === 'preset_move' ? s.presets[c.slot] : null;
            const target =
              c.op === 'center'
                ? [0, 0]
                : p
                  ? [p.pan, p.tilt]
                  : s.axes.map((a, i) => [c.pan, c.tilt][i] + (c.op === 'relative' ? a.target : 0));
            if ((p && !p.valid) || !inRange(target)) {
              s.result = 'range';
              break;
            }
            begin(target, speed);
            s.moving = true;
          }
        }
      }
    }
    s.eta =
      vector || !s.moving
        ? 0
        : Math.max(
            0,
            ...s.axes.map((a, i) => (rates[i] ? Math.abs(a.target - a.degrees) / rates[i] : 0)),
          );
    return structuredClone(s);
  };
}
