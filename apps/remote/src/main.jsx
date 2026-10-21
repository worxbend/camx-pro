import { createSignal, For, Show, onCleanup } from 'solid-js';
import { render } from '@solidjs/web';
import { Session, httpTransport, capabilities } from '@camx-pro/control';
import { demoTransport, initialState } from '@camx-pro/control/demo';
import { JoystickJog } from '@camx-pro/control/joystick';
import { Joystick } from './Joystick.jsx';
import '@fontsource/anton/latin-400.css';
import './style.css';

// Pan and tilt signs of the eight held directions; diagonals drive both axes at once.
const directions = [
  ['up-left', -1, 1, '↖'],
  ['tilt up', 0, 1, '↑'],
  ['up-right', 1, 1, '↗'],
  ['pan left', -1, 0, '←'],
  null,
  ['pan right', 1, 0, '→'],
  ['down-left', -1, -1, '↙'],
  ['tilt down', 0, -1, '↓'],
  ['down-right', 1, -1, '↘'],
];
const steps = [
  ['Pan −', -1, 0],
  ['Pan +', 1, 0],
  ['Tilt −', 0, -1],
  ['Tilt +', 0, 1],
  ['↖', -1, 1, 'Step up-left'],
  ['↗', 1, 1, 'Step up-right'],
  ['↙', -1, -1, 'Step down-left'],
  ['↘', 1, -1, 'Step down-right'],
];
// Printable ASCII without '"' and '\\', as the firmware accepts them.
const validName = (name) => name.length <= 16 && /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/.test(name);

function App() {
  const hosted = !['localhost', '127.0.0.1'].includes(location.hostname);
  const [demo, setDemo] = createSignal(
    new URLSearchParams(location.search).get('demo') === '1' ||
      hosted ||
      !location.pathname.startsWith('/control'),
  );
  const [token, setToken] = createSignal('');
  const [snapshot, setSnapshot] = createSignal({
    state: initialState(),
    connected: false,
    busy: false,
    owned: false,
    error: '',
  });
  const [notice, setNotice] = createSignal('');
  const [pan, setPan] = createSignal(0),
    [tilt, setTilt] = createSignal(0);
  const [referencePan, setReferencePan] = createSignal(0),
    [referenceTilt, setReferenceTilt] = createSignal(0);
  const [aligned, setAligned] = createSignal(false),
    [step, setStep] = createSignal(1);
  const [jogSpeed, setJogSpeed] = createSignal(0.5);
  const [moveSpeed, setMoveSpeed] = createSignal(100),
    [retarget, setRetarget] = createSignal(false);
  const [presetName, setPresetName] = createSignal('');
  const [speedScale, setSpeedScale] = createSignal(100),
    [accelScale, setAccelScale] = createSignal(100),
    [jerkScale, setJerkScale] = createSignal(100);
  const [speed, setSpeed] = createSignal(4),
    [acceleration, setAcceleration] = createSignal(8),
    [jerk, setJerk] = createSignal(80);
  let session, joystickJog;
  const [steering, setSteering] = createSignal(false);
  const [joystickReset, setJoystickReset] = createSignal(0);
  const resetJoystick = () => {
    joystickJog?.cancel();
    setSteering(false);
    setJoystickReset((n) => n + 1);
  };
  const state = () => snapshot().state;
  // Before connecting, offer only what every firmware supports.
  const caps = () => capabilities(snapshot().connected ? state() : null);
  // Background polls and heartbeats do not block the controls: a command issued during one
  // is sent as soon as it returns.
  const busy = () =>
    (snapshot().busy && !!snapshot().pendingOp && snapshot().pendingOp !== 'heartbeat') ||
    !snapshot().connected;
  const ready = () =>
    !busy() && snapshot().owned && state().armed && state().referenced && !state().stopped;
  const canMove = () => ready() && !state().moving && !steering();
  const ownsMotion = () =>
    snapshot().connected &&
    snapshot().owned &&
    state().armed &&
    state().referenced &&
    !state().stopped &&
    !snapshot().error;
  const canSteer = () =>
    ownsMotion() && (!state().moving || steering()) && (!busy() || snapshot().pendingOp === 'jog');
  // With retargeting, a newer target may replace one in progress (never a held jog).
  const canTarget = () =>
    canMove() || (ready() && !steering() && caps().retarget && retarget() && !state().jogging);
  const update = (current) => {
    if (
      steering() &&
      (!current.connected || !current.owned || current.error || current.state?.stopped)
    )
      resetJoystick();
    setSnapshot({
      state: current.state || initialState(),
      connected: current.connected,
      busy: current.busy,
      pendingOp: current.pendingOp,
      owned: current.owned,
      error: current.error,
    });
  };
  async function act(operation) {
    try {
      setNotice('');
      await operation();
    } catch (error) {
      setNotice(error.message || 'Request failed');
    }
  }
  async function connect() {
    if (session) await session.close();
    resetJoystick();
    session = new Session(demo() ? demoTransport() : httpTransport(token()), update);
    joystickJog = new JoystickJog(session);
    setToken('');
    await session.request();
  }
  const command = (op, fields = {}) => act(() => session.request(op, fields));
  // Per-move speed and retargeting are sent only to firmware that understands them.
  const moveOptions = () => ({
    ...(caps().moveSpeed && moveSpeed() < 100 ? { speed: moveSpeed() / 100 } : {}),
    ...(caps().retarget && retarget() && state().moving ? { retarget: true } : {}),
  });
  const target = (op, fields = {}) => command(op, { ...fields, ...moveOptions() });
  const named = () => {
    const name = presetName().trim();
    if (!validName(name))
      throw Error('Name: up to 16 printable ASCII characters, without " or \\.');
    return caps().presetNames && name ? { name } : {};
  };
  const savePreset = (op, fields) => act(() => session.request(op, { ...fields, ...named() }));
  const percent = (n) => Number.isFinite(n) && n >= 5 && n <= 100;
  const stop = () => {
    resetJoystick();
    return act(() => session?.stop());
  };
  const releaseJog = () => {
    setSteering(false);
    return act(() => joystickJog?.release());
  };
  const steer = (pan, tilt) => {
    if (!canSteer()) return;
    setSteering(true);
    return act(() => joystickJog?.set(pan, tilt));
  };
  const tick = setInterval(async () => {
    if (!session) return;
    try {
      await joystickJog?.tick();
      await session.tick();
    } catch {
      resetJoystick();
    }
  }, 100);
  const suspend = () => {
    resetJoystick();
    session?.suspend().catch(() => {});
  };
  const visibility = () => {
    if (document.hidden) suspend();
  };
  const escape = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
    }
  };
  window.addEventListener('keydown', escape);
  window.addEventListener('blur', suspend);
  window.addEventListener('pagehide', suspend);
  document.addEventListener('visibilitychange', visibility);
  onCleanup(() => {
    clearInterval(tick);
    window.removeEventListener('keydown', escape);
    suspend();
    window.removeEventListener('blur', suspend);
    window.removeEventListener('pagehide', suspend);
    document.removeEventListener('visibilitychange', visibility);
  });
  const num = (label, value, set, min, max, step = '0.1') => (
    <label>
      {label}
      <input
        type="number"
        value={value()}
        min={min}
        max={max}
        step={step}
        onInput={(e) => set(e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value))}
      />
    </label>
  );
  function Jog(props) {
    const start = () => steer(props.pan * jogSpeed(), props.tilt * jogSpeed());
    return (
      <button
        class="jog"
        aria-label={props.label}
        disabled={!canSteer()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={releaseJog}
        onPointerCancel={releaseJog}
        onLostPointerCapture={releaseJog}
        onBlur={releaseJog}
        onKeyDown={(e) => {
          if ([' ', 'Enter'].includes(e.key)) {
            e.preventDefault();
            if (!e.repeat) start();
          }
        }}
        onKeyUp={(e) => {
          if ([' ', 'Enter'].includes(e.key)) {
            e.preventDefault();
            releaseJog();
          }
        }}
      >
        {props.children}
      </button>
    );
  }
  const status = () =>
    !snapshot().connected
      ? 'Disconnected'
      : state().stopped
        ? 'STOP latched'
        : state().queued
          ? 'Retargeting'
          : state().moving
            ? 'Moving'
            : state().armed
              ? 'Armed · holding'
              : 'Released';
  return (
    <div class="app-shell">
      <header>
        <a class="brand" href="https://worxbend.github.io/camx-pro/">
          CAMX PRO
        </a>
        <span class="edition">Remote</span>
        <a href="https://github.com/worxbend/camx-pro/blob/main/docs/controllers.md">
          Operator guide ↗
        </a>
      </header>
      <main>
        <div class="page-title">
          <div>
            <h1>Find your angle.</h1>
            <p>Direct control. A lighter touch.</p>
          </div>
          <button
            class="stop"
            onClick={stop}
            disabled={!snapshot().connected && !snapshot().error && !snapshot().busy}
          >
            ■ STOP<span>Latch · hold position</span>
          </button>
        </div>
        <Show when={demo()}>
          <div class="banner">Demo mode — simulated motion. No hardware connected.</div>
        </Show>
        <div class="status-strip" aria-live="polite">
          <strong>
            {status()}
            <Show when={snapshot().connected && state().moving && state().eta > 0}>
              {` · ${state().eta.toFixed(1)} s`}
            </Show>
          </strong>
          <span>
            {state().referenced ? 'Open-loop position estimate' : 'Position unreferenced'}
            <Show when={snapshot().connected && state().settings_dirty}>
              {' · unsaved until release'}
            </Show>
          </span>
          <span>Pan 4:1 / Tilt 2:1</span>
        </div>
        <Show when={snapshot().error || notice()}>
          <p class="error" role="alert">
            {snapshot().error || notice()}
          </p>
        </Show>
        <div class="workspace">
          <section class="panel connection">
            <h2>Connect & reference</h2>
            <label>
              Connection
              <select
                value={demo() ? 'demo' : 'device'}
                disabled={snapshot().connected || snapshot().busy}
                onChange={(e) => setDemo(e.currentTarget.value === 'demo')}
              >
                <option value="demo">Offline demonstration</option>
                <option value="device" disabled={hosted}>
                  Local ESP32 via bridge
                </option>
              </select>
            </label>
            <Show when={!demo()}>
              <label>
                API token
                <input
                  type="password"
                  autocomplete="off"
                  value={token()}
                  onInput={(e) => setToken(e.currentTarget.value)}
                  placeholder="Kept in memory for this session"
                  disabled={snapshot().connected}
                />
              </label>
            </Show>
            <div class="actions">
              <button
                class="primary"
                disabled={snapshot().busy || snapshot().connected}
                onClick={() => act(connect)}
              >
                Connect
              </button>
              <button
                disabled={!snapshot().connected}
                onClick={() =>
                  act(async () => {
                    resetJoystick();
                    await session.close();
                    session = null;
                    setSnapshot({
                      state: initialState(),
                      connected: false,
                      busy: false,
                      owned: false,
                      error: '',
                    });
                  })
                }
              >
                Disconnect
              </button>
            </div>
            <p class="hint">
              {demo()
                ? 'Try the controls with simulated motion.'
                : 'Connect through your local bridge. Your token stays in memory.'}
            </p>
            <hr />
            <h3>Physical reference</h3>
            <p class="hint">
              With coils released, align the mechanism to the angles below. Zero is a reference
              position, not automatic homing.
            </p>
            <div class="fields">
              {num(
                'Actual pan °',
                referencePan,
                setReferencePan,
                state().axes[0].minimum,
                state().axes[0].maximum,
              )}
              {num(
                'Actual tilt °',
                referenceTilt,
                setReferenceTilt,
                state().axes[1].minimum,
                state().axes[1].maximum,
              )}
            </div>
            <Show when={caps().lastPose && state().last_pose?.valid && !state().armed}>
              <div class="last-pose">
                <p class="hint">
                  Last released at{' '}
                  <strong>
                    pan {state().last_pose.pan.toFixed(2)}° · tilt{' '}
                    {state().last_pose.tilt.toFixed(2)}°
                  </strong>
                  . A hint only: check the real alignment before confirming.
                </p>
                <button
                  id="use-last-pose"
                  onClick={() => {
                    setReferencePan(Number(state().last_pose.pan.toFixed(2)));
                    setReferenceTilt(Number(state().last_pose.tilt.toFixed(2)));
                  }}
                >
                  Use as reference angles
                </button>
              </div>
            </Show>
            <label class="check">
              <input
                type="checkbox"
                checked={aligned()}
                onChange={(e) => setAligned(e.currentTarget.checked)}
              />{' '}
              I physically aligned both axes.
            </label>
            <button
              id="reference"
              disabled={
                busy() ||
                state().armed ||
                !aligned() ||
                !Number.isFinite(referencePan() + referenceTilt())
              }
              onClick={() => {
                command('reference', { pan: referencePan(), tilt: referenceTilt() });
                setAligned(false);
              }}
            >
              Confirm reference
            </button>
            <div class="actions">
              <button
                class="primary"
                id="arm"
                disabled={busy() || state().armed || !state().referenced || state().stopped}
                onClick={() => command('arm')}
              >
                Arm motors
              </button>
              <button id="disarm" disabled={busy()} onClick={() => command('disarm')}>
                Release coils
              </button>
            </div>
            <p class="hint">
              Support the camera before release. Releasing invalidates the reference.
            </p>
          </section>
          <section class="panel motion">
            <h2>Take the controls</h2>
            <div class="readouts">
              <For each={['Pan', 'Tilt']}>
                {(axis, index) => (
                  <div>
                    <span>
                      {axis} <small>estimated</small>
                    </span>
                    <output data-testid={axis.toLowerCase()}>
                      {`${state().axes[index()].degrees >= 0 ? '+' : ''}${state().axes[index()].degrees.toFixed(2)}`}
                      <small>°</small>
                    </output>
                    <span>
                      {state().axes[index()].minimum}° to {state().axes[index()].maximum}°
                    </span>
                  </div>
                )}
              </For>
            </div>
            <Joystick
              disabled={!ownsMotion()}
              blocked={!canSteer()}
              reset={joystickReset()}
              speed={jogSpeed()}
              onVector={steer}
              onRelease={releaseJog}
              onStop={stop}
              message={
                !snapshot().connected
                  ? 'Connect, reference, then arm to steer.'
                  : !state().armed || !snapshot().owned || state().stopped
                    ? 'Reference and arm this session to steer.'
                    : steering() && state().moving && !state().jogging
                      ? 'Braking before changing direction…'
                      : state().moving && !steering()
                        ? 'Waiting for motion to settle…'
                        : 'Drag further for more speed. Center is neutral.'
              }
            />
            <div class="joystick-speed" role="group" aria-label="Maximum jog speed">
              <span>Speed</span>
              <For each={[0.25, 0.5, 1]}>
                {(speed) => (
                  <button
                    aria-label={`Jog speed ${speed * 100}%`}
                    aria-pressed={jogSpeed() === speed ? 'true' : 'false'}
                    disabled={steering()}
                    onClick={() => setJogSpeed(speed)}
                  >
                    {speed * 100}%
                  </button>
                )}
              </For>
            </div>
            <div class="joystick-footer">
              <button class="return-zero" disabled={!canTarget()} onClick={() => target('center')}>
                Return to zero
              </button>
              <details class="precision" id="precision-controls">
                <summary>Precision controls</summary>
                <div class="precision-body">
                  <p class="hint">
                    Hold a direction button, or enter an exact target. Direction and speed changes
                    brake before continuing.
                  </p>
                  <div class="dpad" aria-label="Direction buttons">
                    <For each={directions}>
                      {(direction) =>
                        direction ? (
                          <Jog
                            pan={direction[1]}
                            tilt={direction[2]}
                            label={`Hold ${direction[0]}`}
                          >
                            {direction[3]}
                          </Jog>
                        ) : (
                          <span aria-hidden="true">✛</span>
                        )
                      }
                    </For>
                  </div>
                  <div class="fields">
                    {num(
                      'Target pan °',
                      pan,
                      setPan,
                      state().axes[0].minimum,
                      state().axes[0].maximum,
                    )}
                    {num(
                      'Target tilt °',
                      tilt,
                      setTilt,
                      state().axes[1].minimum,
                      state().axes[1].maximum,
                    )}
                  </div>
                  <Show when={caps().moveSpeed || caps().retarget}>
                    <div class="fields move-options">
                      <Show when={caps().moveSpeed}>
                        {num('Move speed %', moveSpeed, setMoveSpeed, 5, 100, '5')}
                      </Show>
                      <Show when={caps().retarget}>
                        <label class="check">
                          <input
                            type="checkbox"
                            checked={retarget()}
                            onChange={(e) => setRetarget(e.currentTarget.checked)}
                          />{' '}
                          Retarget while moving
                        </label>
                      </Show>
                    </div>
                  </Show>
                  <button
                    id="move"
                    class="primary"
                    disabled={
                      !canTarget() || !Number.isFinite(pan() + tilt()) || !percent(moveSpeed())
                    }
                    onClick={() => target('move', { pan: pan(), tilt: tilt() })}
                  >
                    Move to target ↗
                  </button>
                  <p class="hint">
                    Pan and tilt move together with coordinated arrival. The path may curve.
                    <Show when={caps().retarget}>
                      {' '}
                      With retargeting, a new target brakes smoothly and then goes to the newest
                      one.
                    </Show>
                  </p>
                  <div class="nudge">
                    <label>
                      Step
                      <select
                        value={step()}
                        onChange={(e) => setStep(Number(e.currentTarget.value))}
                      >
                        <option value="0.1">0.1°</option>
                        <option value="1">1°</option>
                        <option value="5">5°</option>
                      </select>
                    </label>
                    <For each={steps}>
                      {([name, p, t, label]) => (
                        <button
                          aria-label={label}
                          disabled={!canTarget() || !percent(moveSpeed())}
                          onClick={() => target('relative', { pan: p * step(), tilt: t * step() })}
                        >
                          {name}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </details>
            </div>
          </section>
          <section class="panel presets">
            <h2>Camera positions</h2>
            <Show when={caps().presetNames}>
              <label>
                Name for the next save
                <input
                  type="text"
                  maxlength="16"
                  value={presetName()}
                  placeholder="e.g. Desk, wide shot, overhead"
                  onInput={(e) => setPresetName(e.currentTarget.value)}
                />
              </label>
            </Show>
            <div class="preset-list">
              <For each={state().presets}>
                {(preset, index) => (
                  <div class="preset">
                    <span class="slot">{String(index() + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>
                        {preset.valid && preset.name ? preset.name : `Position ${index() + 1}`}
                      </strong>
                      <small>
                        {preset.valid
                          ? `${preset.pan.toFixed(1)}° / ${preset.tilt.toFixed(1)}°`
                          : 'Empty slot'}
                      </small>
                    </div>
                    <div class="preset-actions">
                      <button
                        aria-label={`Save position ${index() + 1}`}
                        disabled={busy() || state().armed || !Number.isFinite(pan() + tilt())}
                        onClick={() =>
                          savePreset('preset_set', { slot: index(), pan: pan(), tilt: tilt() })
                        }
                      >
                        Save
                      </button>
                      <Show when={caps().saveHere}>
                        <button
                          aria-label={`Save current pose as position ${index() + 1}`}
                          disabled={
                            busy() || !state().referenced || state().moving || state().jogging
                          }
                          onClick={() => savePreset('preset_save', { slot: index() })}
                        >
                          Here
                        </button>
                      </Show>
                      <button
                        aria-label={`Recall position ${index() + 1}`}
                        disabled={!canTarget() || !preset.valid || !percent(moveSpeed())}
                        onClick={() => target('preset_move', { slot: index() })}
                      >
                        Go
                      </button>
                      <Show when={caps().clearPreset}>
                        <button
                          aria-label={`Clear position ${index() + 1}`}
                          disabled={busy() || !preset.valid}
                          onClick={() => command('preset_clear', { slot: index() })}
                        >
                          ×
                        </button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <p class="hint preset-help">
              Save stores the target while released. Here stores the current pose. Go recalls after
              reference and arm.
            </p>
          </section>
        </div>
        <details class="motion-settings" id="motion-settings">
          <summary>Motion settings</summary>
          <Show when={caps().scales}>
            <section class="settings panel feel">
              <div>
                <h2>Speed, acceleration & smoothness</h2>
                <p class="hint">
                  Lowers the configured ceilings for the next moves and jogs. Allowed while armed;
                  nothing is saved and no new reference is needed. Now:{' '}
                  {Math.round(state().motion.speed * 100)} % ·{' '}
                  {Math.round(state().motion.accel * 100)} % ·{' '}
                  {Math.round(state().motion.jerk * 100)} %.
                </p>
              </div>
              <div class="fields">
                {num('Speed %', speedScale, setSpeedScale, 5, 100, '5')}
                {num('Acceleration %', accelScale, setAccelScale, 5, 100, '5')}
                {num('Smoothness (jerk) %', jerkScale, setJerkScale, 5, 100, '5')}
                <button
                  id="apply-feel"
                  disabled={busy() || ![speedScale(), accelScale(), jerkScale()].every(percent)}
                  onClick={() =>
                    command('motion', {
                      speed: speedScale() / 100,
                      accel: accelScale() / 100,
                      jerk: jerkScale() / 100,
                    })
                  }
                >
                  Apply feel
                </button>
              </div>
            </section>
          </Show>
          <section class="settings panel">
            <div>
              <h2>{caps().jerk ? 'Speed, acceleration & jerk' : 'Speed & acceleration'}</h2>
              <p class="hint">
                Stored device settings for both axes. Applies while released; requires a fresh
                reference. Travel limits and gear calibration remain device settings.
                <Show when={caps().jerk}> Jerk above 80 °/s³ needs commissioned settings.</Show>
              </p>
            </div>
            <div class="fields">
              {num('Speed °/s', speed, setSpeed, 0.1, 8)}
              {num('Acceleration °/s²', acceleration, setAcceleration, 0.1, 20)}
              <Show when={caps().jerk}>{num('Jerk °/s³', jerk, setJerk, 1, 500, '1')}</Show>
              <button
                disabled={
                  busy() ||
                  state().armed ||
                  !Number.isFinite(speed() + acceleration()) ||
                  (caps().jerk && !(jerk() >= 1 && jerk() <= 500))
                }
                onClick={() =>
                  command('settings', {
                    pan_speed: speed(),
                    tilt_speed: speed(),
                    pan_accel: acceleration(),
                    tilt_accel: acceleration(),
                    ...(caps().jerk ? { pan_jerk: jerk(), tilt_jerk: jerk() } : {}),
                  })
                }
              >
                Apply profile
              </button>
            </div>
          </section>
        </details>
        <details>
          <summary>Device diagnostics</summary>
          <pre id="diagnostics">{JSON.stringify(state(), null, 2)}</pre>
        </details>
      </main>
      <footer>
        CAMX PRO · P3 PROTOTYPE{' '}
        <span>USB video stays with the webcam. This application controls motion only.</span>
      </footer>
    </div>
  );
}
render(() => <App />, document.getElementById('app'));
