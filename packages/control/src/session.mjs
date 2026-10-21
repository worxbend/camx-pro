/** API v1 session. One in-flight normal request; STOP invalidates all late replies. */
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

/** Minor API revision: absent (0) for firmware 1.0.0, 1 for firmware 1.1.0. */
export const apiMinor = (s) => (uint(s?.api_minor) ? s.api_minor : 0);

/**
 * What the connected firmware supports beyond the original API v1 commands. Firmware 1.1.0
 * (api_minor 1) adds runtime motion scales, per-move speed, retargeting, named presets,
 * saving the present pose, clearing presets, the last-pose hint and the jerk setting.
 */
export function capabilities(s) {
  const v11 = apiMinor(s) >= 1;
  return {
    scales: v11,
    moveSpeed: v11,
    retarget: v11,
    presetNames: v11,
    saveHere: v11,
    clearPreset: v11,
    lastPose: v11,
    jerk: v11,
  };
}

export function validateState(s) {
  if (
    !s ||
    s.api !== 1 ||
    !uint(s.epoch) ||
    !uint(s.seq) ||
    typeof s.result !== 'string' ||
    ![
      'armed',
      'referenced',
      'stopped',
      'moving',
      'jogging',
      'commissioned',
      'storage_ok',
      'settings_dirty',
    ].every((k) => typeof s[k] === 'boolean') ||
    typeof s.fault !== 'string' ||
    !Array.isArray(s.axes) ||
    s.axes.length !== 2 ||
    !s.axes.every(
      (a) =>
        [
          'degrees',
          'target',
          'steps',
          'velocity',
          'motor_steps',
          'reduction',
          'minimum',
          'maximum',
          'speed',
          'acceleration',
        ].every((k) => finite(a[k])) &&
        a.minimum < a.maximum &&
        a.reduction > 0 &&
        typeof a.inverted === 'boolean',
    ) ||
    !Array.isArray(s.presets) ||
    s.presets.length !== 8 ||
    !s.presets.every((p) => typeof p.valid === 'boolean' && finite(p.pan) && finite(p.tilt)) ||
    ('api_minor' in s && !uint(s.api_minor)) ||
    (apiMinor(s) >= 1 && !validMinorOne(s))
  ) {
    throw Error('Invalid or incompatible firmware state');
  }
  return s;
}

// Fields that firmware 1.1.0 always sends. Older firmware omits them; then nothing is checked.
function validMinorOne(s) {
  const scale = (n) => finite(n) && n >= 0.05 && n <= 1;
  // Printable ASCII without '"' and '\\', as the firmware accepts them.
  const name = (n) =>
    typeof n === 'string' && n.length <= 16 && /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/.test(n);
  return (
    typeof s.queued === 'boolean' &&
    finite(s.eta) &&
    s.eta >= 0 &&
    !!s.motion &&
    ['speed', 'accel', 'jerk'].every((k) => scale(s.motion[k])) &&
    !!s.last_pose &&
    typeof s.last_pose.valid === 'boolean' &&
    finite(s.last_pose.pan) &&
    finite(s.last_pose.tilt) &&
    s.axes.every((a) => finite(a.jerk) && a.jerk > 0 && finite(a.accel_now)) &&
    s.presets.every((p) => name(p.name))
  );
}

export function httpTransport(token, { fetcher = fetch, timeout = 1800 } = {}) {
  if (!/^[\x21-\x7e]{16,128}$/.test(token))
    throw Error('Enter the configured API token (16–128 printable characters).');
  return async (command, signal) => {
    const response = await fetcher(command ? '/api/command' : '/api/state', {
      method: command ? 'POST' : 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(command ? { 'Content-Type': 'application/json', 'X-CAMX-Request': '1' } : {}),
      },
      body: command ? JSON.stringify(command) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    if (response.status === 401) throw Error('Authentication rejected');
    const body = await response.text();
    if (body.length > 16384) throw Error('Oversized firmware response');
    // A rejected command still returns the authoritative epoch and consumed sequence.
    return validateState(JSON.parse(body));
  };
}

export class Session {
  constructor(exchange, onChange = () => {}, now = () => performance.now()) {
    this.exchange = exchange;
    this.onChange = onChange;
    this.now = now;
    this.state = null;
    this.connected = false;
    this.owned = false;
    this.busy = false;
    this.error = '';
    this.generation = 0;
    this.lastHeartbeat = 0;
    this.lastPoll = 0;
    this.jog = null;
    this.wanted = null; // a jog pressed while another request was in flight
    this.lastJog = 0;
    this.pendingOp = null;
  }
  publish() {
    this.onChange(this);
  }
  async request(op, fields = {}) {
    if (this.busy) throw Error('Wait for the pending request');
    if (op && (!this.connected || !this.state)) throw Error('Connect and read state first');
    if (['move', 'relative', 'center', 'preset_move', 'jog'].includes(op) && !this.owned)
      throw Error('Arm this controller session before movement');
    if (op && this.state.seq === 0xffffffff)
      throw Error('Sequence exhausted; STOP and reference again');
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    this.pendingOp = op;
    this.publish();
    try {
      const command = op
        ? { ...fields, op, epoch: this.state.epoch, seq: this.state.seq + 1 }
        : null;
      const result = validateState(await this.exchange(command, abort.signal));
      if (generation !== this.generation) return;
      const changedEpoch = this.state && this.state.epoch !== result.epoch;
      const foreignSequence = !op && this.state && this.state.seq !== result.seq;
      this.state = result;
      this.connected = true;
      if (op !== 'heartbeat' && op)
        this.error = result.result === 'ok' ? '' : `${op}: ${result.result}`;
      if (
        changedEpoch ||
        foreignSequence ||
        result.result === 'stale' ||
        !result.armed ||
        result.stopped
      ) {
        this.owned = false;
        this.jog = null;
      }
      if (op === 'arm' && result.result === 'ok') this.owned = true;
      if (op === 'heartbeat' || op === 'arm') this.lastHeartbeat = this.now();
      if (op === 'jog' && result.result !== 'ok') this.jog = null;
      this.lastPoll = this.now();
      return result;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error =
        'Connection failed. Command outcome may be unknown; reconnect and inspect the mechanism.';
      const mustStop =
        this.owned || ['arm', 'move', 'relative', 'center', 'jog', 'preset_move'].includes(op);
      this.connected = false;
      this.owned = false;
      this.jog = null;
      if (mustStop) await this.stop();
      // Preserve the failed request indication even if best-effort STOP succeeds.
      this.error = 'Connection failed; no command was retried. Reconnect before continuing.';
      this.connected = false;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.pendingOp = null;
      }
      this.publish();
      // A press that arrived during this request starts now, if it is still held.
      const wanted = this.wanted;
      this.wanted = null;
      if (wanted && this.connected && generation === this.generation)
        this.beginJog(wanted.pan, wanted.tilt).catch(() => {});
    }
  }
  async stop() {
    const generation = ++this.generation;
    this.abort?.abort();
    this.jog = null;
    this.wanted = null;
    this.owned = false;
    this.busy = true;
    this.pendingOp = 'stop';
    const abort = new AbortController();
    this.abort = abort;
    this.publish();
    try {
      const state = validateState(await this.exchange({ op: 'stop' }, abort.signal));
      if (generation === this.generation) {
        this.state = state;
        this.connected = true;
        this.error = state.stopped ? '' : 'STOP was not acknowledged';
      }
    } catch {
      if (generation === this.generation) {
        this.connected = false;
        this.error = 'STOP unconfirmed. Device watchdog remains the fallback.';
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.pendingOp = null;
      }
      this.publish();
    }
  }
  async beginJog(pan, tilt) {
    if (!this.owned || this.jog || this.state.moving || this.state.stopped) return;
    // A poll or heartbeat is in flight: start once it completes instead of dropping the press.
    if (this.busy) {
      this.wanted = { pan, tilt };
      return;
    }
    this.jog = { pan, tilt };
    this.lastJog = this.now();
    await this.request('jog', this.jog);
  }
  async endJog() {
    if (this.wanted) {
      this.wanted = null; // released before it could start
      return;
    }
    if (!this.jog) return;
    this.jog = null;
    // A release cannot sit behind an ambiguous request and later renew motion.
    if (this.busy) return this.stop();
    return this.request('jog', { pan: 0, tilt: 0 });
  }
  async tick() {
    if (!this.connected) return;
    const now = this.now();
    if (this.jog && now - this.lastJog > 400) return this.stop();
    if (this.busy) return;
    if (this.owned && now - this.lastHeartbeat >= 1000) return this.request('heartbeat');
    if (this.jog && now - this.lastJog >= 150) {
      this.lastJog = now;
      return this.request('jog', this.jog);
    }
    if (now - this.lastPoll >= 500) return this.request();
  }
  async suspend() {
    if (
      this.owned ||
      ['arm', 'move', 'relative', 'jog', 'center', 'preset_move'].includes(this.pendingOp)
    )
      await this.stop();
  }
  async close() {
    await this.suspend();
    ++this.generation;
    this.abort?.abort();
    this.connected = false;
    this.owned = false;
    this.onChange = () => {};
  }
}
