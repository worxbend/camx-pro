import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.mjs';
import { demoTransport } from '../src/demo.mjs';
import { joystickVector, JoystickJog } from '../src/joystick.mjs';

test('joystick clamps radial travel, maps screen directions, and respects dead zone and speed', () => {
  assert.deepEqual(joystickVector(0.1, 0.1), { pan: 0, tilt: 0 });
  assert.deepEqual(joystickVector(10, 0, 0.25), { pan: 0.25, tilt: 0 });
  assert.deepEqual(joystickVector(0, -1), { pan: 0, tilt: 0.5 });
  assert.deepEqual(joystickVector(1, -1), { pan: 0.35, tilt: 0.35 });
  for (const speed of [0.25, 0.5, 1])
    for (let x = -1.1; x <= 1.1; x += 0.03)
      for (let y = -1.1; y <= 1.1; y += 0.03) {
        const value = joystickVector(x, y, speed);
        for (const fraction of Object.values(value))
          assert(fraction === 0 || (Math.abs(fraction) >= 0.025 && Math.abs(fraction) <= speed));
      }
  assert.throws(() => joystickVector(NaN, 0));
});

async function rig() {
  let now = 0,
    blocked = null,
    fail = false;
  const sent = [],
    demo = demoTransport(() => now);
  const session = new Session(
    async (command) => {
      sent.push(command);
      if (blocked) await blocked;
      if (fail && command?.op !== 'stop') throw Error('Connection lost');
      return demo(command);
    },
    () => {},
    () => now,
  );
  await session.request();
  await session.request('reference', { pan: 0, tilt: 0 });
  await session.request('arm');
  const joystick = new JoystickJog(session);
  const advance = async () => {
    now += 100;
    await joystick.tick();
    await session.tick();
  };
  return {
    session,
    joystick,
    sent,
    advance,
    block() {
      let release;
      blocked = new Promise((r) => {
        release = r;
      });
      return () => {
        blocked = null;
        release();
      };
    },
    fail() {
      fail = true;
    },
  };
}

test('changing joystick direction brakes first and only the latest held vector is sent', async () => {
  const { session, joystick, sent, advance } = await rig();
  await joystick.set(0.5, 0);
  assert.deepEqual(session.jog, { pan: 0.5, tilt: 0 });
  const unblock = (() => {
    let done;
    const prior = session.exchange;
    session.exchange = async (c, signal) => {
      if (c?.op === 'jog' && c.pan === 0 && c.tilt === 0) await new Promise((r) => (done = r));
      return prior(c, signal);
    };
    return () => done();
  })();
  const turn = joystick.set(0.3, 0.4);
  await joystick.set(-0.5, -0.5);
  unblock();
  await turn;
  await advance();
  assert.deepEqual(
    sent.filter((c) => c?.op === 'jog').map(({ pan, tilt }) => [pan, tilt]),
    [
      [0.5, 0],
      [0, 0],
      [-0.5, -0.5],
    ],
  );
});

test('release during initial jog request orders a zero vector and cancels pending direction', async () => {
  const { session, joystick, sent, advance, block } = await rig();
  const unblock = block();
  const start = joystick.set(0.5, 0.5);
  await joystick.set(-0.5, 0);
  const release = joystick.release();
  unblock();
  await Promise.all([start, release]);
  for (let i = 0; i < 8; i++) await advance();
  assert.equal(joystick.desired, null);
  assert.equal(session.jog, null);
  assert.deepEqual(
    sent.filter((c) => c?.op === 'jog').map(({ pan, tilt }) => [pan, tilt]),
    [
      [0.5, 0.5],
      [0, 0],
    ],
  );
  assert(session.state.referenced && !session.state.stopped);
});

test('pointer release before a background request completes never starts queued motion', async () => {
  const { joystick, session, sent, block, advance } = await rig();
  const unblock = block();
  const poll = session.request();
  await joystick.set(0.5, 0);
  await joystick.release();
  unblock();
  await poll;
  await advance();
  assert(!sent.some((c) => c?.op === 'jog'));
});

test('braking waits for actual idle state; release while braking prevents restart', async () => {
  const { joystick, session, sent, advance } = await rig();
  await joystick.set(0.5, 0);
  await joystick.set(-0.5, 0);
  // The browser demo brakes instantly; hold authoritative moving state to model firmware deceleration.
  session.state.moving = true;
  session.lastPoll = 10000;
  for (let i = 0; i < 3; i++) await advance();
  assert.equal(session.jog, null);
  assert(!sent.some((c) => c?.pan === -0.5));
  await joystick.release();
  session.state.moving = false;
  await advance();
  assert(!sent.some((c) => c?.pan === -0.5));
});

test('STOP, ownership loss and failed exchanges discard all joystick intent', async () => {
  for (const cause of ['stop', 'ownership', 'failure']) {
    const { joystick, session, sent, advance, fail } = await rig();
    await joystick.set(0.5, 0);
    await joystick.set(-0.5, 0);
    if (cause === 'stop') await session.stop();
    if (cause === 'ownership') session.owned = false;
    if (cause === 'failure') {
      fail();
      await session.request().catch(() => {});
    }
    const count = sent.length;
    await advance();
    assert.equal(joystick.desired, null, cause);
    assert(!sent.slice(count).some((c) => c?.op === 'jog'), cause);
  }
});
