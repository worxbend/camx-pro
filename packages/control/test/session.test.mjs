import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, validateState, httpTransport } from '../src/session.mjs';
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
