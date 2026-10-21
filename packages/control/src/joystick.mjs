/** Map a circular joystick to firmware-valid axis speed fractions. Screen Y points down. */
export function joystickVector(x, y, speed = 0.5) {
  if (![x, y, speed].every(Number.isFinite) || speed < 0.05 || speed > 1)
    throw Error('Invalid joystick input');
  const distance = Math.hypot(x, y);
  if (distance <= 0.16) return { pan: 0, tilt: 0 };
  const gain = ((Math.min(distance, 1) - 0.16) / 0.84) * speed;
  // 5% increments reject pointer noise and never send the firmware's invalid (0, 2.5%) range.
  const quantize = (value) => Math.round(value * 20) / 20 || 0;
  return { pan: quantize((x / distance) * gain), tilt: quantize((-y / distance) * gain) };
}

const same = (a, b) => a?.pan === b?.pan && a?.tilt === b?.tilt;

/** Latest held intent, not a command queue. API v1 requires a full brake before a new jog vector. */
export class JoystickJog {
  constructor(session) {
    this.session = session;
    this.desired = null;
    this.generation = session.generation;
    this.running = false;
    this.braking = false;
  }

  set(pan, tilt) {
    if (
      ![pan, tilt].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= 1 && (v === 0 || Math.abs(v) >= 0.025),
      )
    )
      throw Error('Invalid jog vector');
    if (!pan && !tilt) return this.release();
    const s = this.session;
    if (!s.connected || !s.owned || s.state.stopped || s.error) return;
    if (!this.desired) this.generation = s.generation;
    this.desired = { pan, tilt };
    return this.tick();
  }

  cancel() {
    this.desired = null;
    this.braking = false;
  }

  release() {
    this.cancel();
    // endJog orders a zero vector behind an in-flight jog request, or sends STOP if uncertain.
    return this.session.endJog();
  }

  async tick() {
    const s = this.session;
    if (
      !s.connected ||
      !s.owned ||
      s.state.stopped ||
      s.error ||
      s.generation !== this.generation
    ) {
      this.cancel();
      return;
    }
    if (this.running || s.busy || !this.desired) return;
    this.running = true;
    try {
      if (s.jog) {
        if (!same(s.jog, this.desired)) {
          this.braking = true;
          await s.endJog();
        }
      } else if (s.state.moving) {
        // Poll promptly while braking; never send a changed nonzero vector into a moving axis.
        if (this.braking && s.now() - s.lastPoll >= 100) await s.request();
      } else {
        this.braking = false;
        await s.beginJog(this.desired.pan, this.desired.tilt);
      }
    } finally {
      this.running = false;
    }
  }
}
