import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, validateState, httpTransport, apiMinor, capabilities } from '../src/session.mjs';
import { demoTransport, initialState } from '../src/demo.mjs';
const fixture = JSON.parse(
  readFileSync(new URL('../../../contracts/state-v1.json', import.meta.url)),
);
const fresh = () => structuredClone(fixture);
test('accept actual C++ contract; reject wrong versions, incomplete axes and nonfinite data', () => {
  validateState(fresh());
  for (const modify of [
    (s) => (s.api = 2),
    (s) => s.axes.pop(),
    (s) => (s.epoch = -1),
    (s) => (s.axes[0].degrees = NaN),
    (s) => (s.presets[0].pan = '0'),
    (s) => (s.armed = 1),
  ]) {
    const s = fresh();
    modify(s);
    assert.throws(() => validateState(s));
  }
});
test('reference rotates epoch, commands serialize, rejected command consumes sequence', async () => {
  const sent = [];
  const demo = demoTransport();
  const session = new Session(async (c) => {
    sent.push(c);
    return demo(c);
  });
  await session.request();
  await session.request('reference', { pan: 0, tilt: 0 });
  const epoch = session.state.epoch;
  await session.request('arm');
  assert(session.owned);
  await session.request('move', { pan: 500, tilt: 0 });
  assert.equal(session.state.result, 'range');
  await session.request('heartbeat');
  assert.equal(sent.at(-1).seq, 3);
  assert.equal(sent.at(-1).epoch, epoch);
  await session.request('disarm');
  assert(!session.owned);
  assert(!session.state.referenced);
});
test('STOP supersedes delayed ARM reply and does not queue a move', async () => {
  let resolve;
  const session = new Session(async (c) => {
    if (c?.op === 'arm') return new Promise((r) => (resolve = r));
    return { ...fresh(), stopped: c?.op === 'stop', epoch: c?.op === 'stop' ? 999 : 12345 };
  });
  await session.request();
  const pending = session.request('arm');
  await assert.rejects(session.request('move', { pan: 2, tilt: 0 }), /pending/);
  await session.stop();
  resolve({ ...fresh(), armed: true, referenced: true });
  await pending;
  assert.equal(session.state.epoch, 999);
  assert(session.state.stopped);
  assert(!session.owned);
});
test('failed mutation sends one best-effort STOP and is never retried', async () => {
  const sent = [];
  const session = new Session(async (c) => {
    sent.push(c?.op);
    if (c?.op === 'arm') throw Error('timeout');
    return { ...fresh(), stopped: c?.op === 'stop' };
  });
  await session.request();
  await assert.rejects(session.request('arm'));
  assert.deepEqual(sent, [undefined, 'arm', 'stop']);
  assert(!session.owned);
  assert(!session.connected);
});
test('read-only observers never heartbeat another controller', async () => {
  let now = 0;
  const sent = [];
  const session = new Session(
    async (c) => {
      sent.push(c?.op);
      return { ...fresh(), armed: true };
    },
    () => {},
    () => now,
  );
  await session.request();
  now = 2000;
  await session.tick();
  assert.deepEqual(sent, [undefined, undefined]);
});
test('lost jog lease stops instead of silently restarting; release during request stops', async () => {
  let now = 0;
  const demo = demoTransport(() => now);
  const sent = [];
  const session = new Session(
    async (c) => {
      sent.push(c?.op);
      return demo(c);
    },
    () => {},
    () => now,
  );
  await session.request();
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  await session.beginJog(0.5, 0);
  now = 450;
  await session.tick();
  assert.equal(sent.at(-1), 'stop');
  assert.equal(session.jog, null);
});
test('close prevents late poll from reconnecting a retired controller', async () => {
  let resolve;
  let changes = 0;
  const session = new Session(
    () => new Promise((r) => (resolve = r)),
    () => changes++,
  );
  const pending = session.request();
  await session.close();
  const before = changes;
  resolve(fresh());
  await pending;
  assert.equal(changes, before);
  assert(!session.connected);
});
test('transport uses bearer header, blocks redirects, parses rejected authoritative state', async () => {
  let request;
  const transport = httpTransport('example-token-123456', {
    fetcher: async (url, init) => {
      request = { url, ...init };
      return new Response(JSON.stringify({ ...initialState(), result: 'busy', seq: 7 }), {
        status: 409,
      });
    },
  });
  const result = await transport({ op: 'arm' }, new AbortController().signal);
  assert.equal(result.seq, 7);
  assert.equal(request.url, '/api/command');
  assert.equal(request.headers.Authorization, 'Bearer example-token-123456');
  assert.equal(request.redirect, 'error');
  assert.throws(() => httpTransport('invalid\nheader'));
});

test('jog renewals do not starve heartbeats when timer cadence is coarse', async () => {
  let now = 0;
  const sent = [];
  const demo = demoTransport(() => now);
  const session = new Session(
    async (c) => {
      sent.push(c?.op);
      return demo(c);
    },
    () => {},
    () => now,
  );
  await session.request();
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  await session.beginJog(0.5, 0);
  for (now = 175; now <= 1400; now += 175) await session.tick();
  assert(sent.includes('heartbeat'));
  assert(!session.state.stopped);
});

// Firmware 1.0.0 sent none of the 1.1.0 fields. Removing them must still validate.
const legacy = () => {
  const s = fresh();
  for (const key of ['api_minor', 'queued', 'eta', 'motion', 'max_tick_cost_us', 'last_pose'])
    delete s[key];
  s.firmware = 'camx-pro-1.0.0';
  s.axes.forEach((a) => {
    delete a.jerk;
    delete a.accel_now;
  });
  s.presets.forEach((p) => delete p.name);
  return s;
};

test('capabilities follow api_minor; 1.0.0 states still validate without new fields', () => {
  assert.equal(apiMinor(fresh()), 1);
  assert(Object.values(capabilities(fresh())).every(Boolean));
  const old = legacy();
  validateState(old);
  assert.equal(apiMinor(old), 0);
  assert(Object.values(capabilities(old)).every((v) => v === false));
  assert(Object.values(capabilities(null)).every((v) => v === false));
});

test('a state that claims api_minor 1 must carry well-formed 1.1.0 fields', () => {
  for (const modify of [
    (s) => (s.api_minor = -1),
    (s) => (s.api_minor = 1.5),
    (s) => delete s.motion,
    (s) => (s.motion.speed = 0),
    (s) => (s.motion.jerk = 2),
    (s) => (s.eta = -1),
    (s) => (s.queued = 'no'),
    (s) => (s.last_pose.pan = NaN),
    (s) => delete s.axes[1].jerk,
    (s) => (s.presets[3].name = 'é'),
    (s) => (s.presets[3].name = 'x'.repeat(17)),
    (s) => (s.presets[3].name = 7),
  ]) {
    const s = fresh();
    modify(s);
    assert.throws(() => validateState(s));
  }
});

async function demoSession() {
  let now = 0;
  const demo = demoTransport(() => now);
  const sent = [];
  const session = new Session(
    async (c) => {
      sent.push(c);
      return demo(c);
    },
    () => {},
    () => now,
  );
  const clock = {
    get now() {
      return now;
    },
    advance: async (ms) => {
      for (const until = now + ms; now < until;) {
        now += 50;
        await session.tick();
      }
    },
  };
  await session.request();
  return { session, clock, sent };
}

test('demo: diagonal moves arrive together; diagonal jog drives both axes', async () => {
  const { session, clock } = await demoSession();
  validateState(session.state);
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  await session.request('relative', { pan: 8, tilt: -2 });
  assert(session.state.eta > 1.9 && session.state.eta < 2.1); // 8 degrees at 4 deg/s
  let tiltDone = null;
  while (session.state.moving) {
    await clock.advance(50);
    if (tiltDone === null && Math.abs(session.state.axes[1].degrees + 2) < 1e-6)
      tiltDone = clock.now;
  }
  assert(Math.abs(session.state.axes[0].degrees - 8) < 1e-6);
  assert(tiltDone >= 1900, `tilt finished early at ${tiltDone} ms`);
  await session.beginJog(-0.5, 0.5);
  await clock.advance(1000);
  await session.endJog();
  await clock.advance(300);
  const [pan, tilt] = session.state.axes.map((a) => a.degrees);
  assert(pan < 7.5 && tilt > -1.5, `diagonal jog moved to ${pan}, ${tilt}`);
  assert(Math.abs(8 - pan - (tilt + 2)) < 0.3); // equal rates on both axes
});

test('demo: motion scales, per-move speed and retarget', async () => {
  const { session, clock } = await demoSession();
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  await session.request('motion', { speed: 0.5 });
  assert.equal(session.state.motion.speed, 0.5);
  await session.request('motion', {});
  assert.equal(session.state.result, 'invalid');
  await session.request('motion', { accel: 0 });
  assert.equal(session.state.result, 'range');
  await session.request('move', { pan: 4, tilt: 0, speed: 0.5 });
  assert(session.state.eta > 3.9 && session.state.eta < 4.1); // 4 deg at 4 * 0.5 * 0.5
  await clock.advance(500);
  await session.request('move', { pan: -4, tilt: 0 });
  assert.equal(session.state.result, 'busy');
  await session.request('move', { pan: -4, tilt: 0, retarget: true });
  assert.equal(session.state.result, 'ok');
  await session.request('relative', { pan: 1, tilt: 0, retarget: true });
  assert.equal(session.state.axes[0].target, -3); // adds to the newest target
  while (session.state.moving) await clock.advance(100);
  assert(Math.abs(session.state.axes[0].degrees + 3) < 1e-6);
  await session.request('move', { pan: 1, tilt: 0, speed: 2 });
  assert.equal(session.state.result, 'range');
});

test('demo: named presets, saving the present pose, clearing and the last pose', async () => {
  const { session, clock } = await demoSession();
  await session.request('preset_save', { slot: 0 });
  assert.equal(session.state.result, 'not_referenced');
  await session.request('preset_set', { slot: 1, pan: 3, tilt: 1, name: 'Desk' });
  assert.deepEqual(session.state.presets[1], { valid: true, pan: 3, tilt: 1, name: 'Desk' });
  await session.request('preset_set', { slot: 1, pan: 4, tilt: 1 });
  assert.equal(session.state.presets[1].name, 'Desk');
  await session.request('preset_set', { slot: 2, pan: 1, tilt: 1, name: 'caf\u00e9' });
  assert.equal(session.state.result, 'invalid');
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  await session.request('move', { pan: 5, tilt: -3 });
  await session.request('preset_save', { slot: 4, name: 'Wide' });
  assert.equal(session.state.result, 'busy');
  while (session.state.moving) await clock.advance(100);
  await session.request('preset_save', { slot: 4, name: 'Wide' });
  assert.deepEqual(session.state.presets[4], { valid: true, pan: 5, tilt: -3, name: 'Wide' });
  await session.request('preset_clear', { slot: 1 });
  assert.equal(session.state.presets[1].valid, false);
  await session.request('disarm');
  assert.deepEqual(session.state.last_pose, { valid: true, pan: 5, tilt: -3 });
  await session.request('settings', { pan_jerk: 40, tilt_jerk: 40 });
  assert.equal(session.state.axes[0].jerk, 40);
});

test('a jog pressed during an in-flight poll starts when the poll returns; an early release cancels it', async () => {
  let now = 0;
  const demo = demoTransport(() => now);
  const sent = [];
  let hold = null;
  const session = new Session(
    async (c) => {
      sent.push(c?.op);
      if (!c && hold) await hold;
      return demo(c);
    },
    () => {},
    () => now,
  );
  await session.request();
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  let release;
  hold = new Promise((r) => (release = r));
  const poll = session.request();
  await session.beginJog(0.5, 0.5); // ignored before this fix: the poll was in flight
  assert.equal(session.jog, null);
  hold = null;
  release();
  await poll;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(session.jog, { pan: 0.5, tilt: 0.5 });
  assert.equal(sent.at(-1), 'jog');
  await session.endJog();
  now += 1000;
  while (session.state.moving) {
    now += 100;
    await session.request();
  }
  // Released before the poll returned: nothing starts.
  hold = new Promise((r) => (release = r));
  const second = session.request();
  await session.beginJog(-0.5, 0);
  await session.endJog();
  hold = null;
  release();
  await second;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(session.jog, null);
  assert(!session.state.jogging);
});
