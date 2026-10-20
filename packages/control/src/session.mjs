/** API v1 session. One in-flight normal request; STOP invalidates all late replies. */
export function validateState(s) {
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
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
    !s.presets.every((p) => typeof p.valid === 'boolean' && finite(p.pan) && finite(p.tilt))
  ) {
    throw Error('Invalid or incompatible firmware state');
  }
  return s;
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
    }
  }
  async stop() {
    const generation = ++this.generation;
    this.abort?.abort();
    this.jog = null;
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
    if (!this.owned || this.busy || this.state.moving || this.state.stopped) return;
    this.jog = { pan, tilt };
    this.lastJog = this.now();
    await this.request('jog', this.jog);
  }
  async endJog() {
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
