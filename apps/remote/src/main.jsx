import { createSignal, For, Show, onCleanup } from 'solid-js';
import { render } from '@solidjs/web';
import { Session, httpTransport, capabilities } from '@camx/control';
import { demoTransport, initialState } from '@camx/control/demo';
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
  let session;
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
  const canMove = () => ready() && !state().moving;
  // With retargeting, a newer target may replace one in progress (never a held jog).
  const canTarget = () =>
    canMove() || (ready() && caps().retarget && retarget() && !state().jogging);
  const update = (current) =>
    setSnapshot({
      state: current.state || initialState(),
      connected: current.connected,
      busy: current.busy,
      pendingOp: current.pendingOp,
      owned: current.owned,
      error: current.error,
    });
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
    session = new Session(demo() ? demoTransport() : httpTransport(token()), update);
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
  const stop = () => act(() => session?.stop());
  const releaseJog = () => act(() => session?.endJog());
  const tick = setInterval(() => {
    if (session) session.tick().catch(() => {});
  }, 100);
  const suspend = () => {
    session?.suspend().catch(() => {});
  };
  const visibility = () => {
    if (document.hidden) suspend();
  };
  window.addEventListener('blur', suspend);
  window.addEventListener('pagehide', suspend);
  document.addEventListener('visibilitychange', visibility);
  onCleanup(() => {
    clearInterval(tick);
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
    const start = () =>
      act(() => session?.beginJog(props.pan * jogSpeed(), props.tilt * jogSpeed()));
    return (
      <button
        class="jog"
        aria-label={props.label}
        disabled={!canMove() && !state().jogging}
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
          C<span>+</span> <b>CAMX PRO</b>
        </a>
        <span class="edition">REMOTE / {demo() ? 'DEMO' : 'LOCAL DEVICE'}</span>
        <a href="https://github.com/worxbend/camx-pro/blob/main/docs/controllers.md">
          Operator guide ↗
        </a>
      </header>
      <main>
        <div class="page-title">
          <div>
            <p class="eyebrow">CAMERA MOTION CONTROL</p>
            <h1>Find your angle.</h1>
            <p>Geared movement. Deliberate control.</p>
          </div>
          <button
            class="stop"
            onClick={stop}
            disabled={!snapshot().connected && !snapshot().error && !snapshot().busy}
          >
            ■ STOP<span>Latch · keep holding torque</span>
          </button>
        </div>
        <Show when={demo()}>
          <div class="banner">
            DEMO · Simulated positions. No hardware connection or video stream.
          </div>
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
          <span>PAN 4:1 / TILT 2:1</span>
        </div>
        <Show when={snapshot().error || notice()}>
          <p class="error" role="alert">
            {snapshot().error || notice()}
          </p>
        </Show>
        <div class="workspace">
          <section class="panel connection">
            <p class="section-number">01 / SESSION</p>
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
              For hardware: build the remote, then run{' '}
              <code>CAMX_DEVICE_URL=http://DEVICE_IP npm run bridge</code>. Open the localhost URL.
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
            <p class="section-number">02 / POSITION</p>
            <h2>Pan & tilt</h2>
            <div class="readouts">
              <For each={['Pan', 'Tilt']}>
                {(axis, index) => (
                  <div>
                    <span>
                      {axis} <small>estimated</small>
                    </span>
                    <output data-testid={axis.toLowerCase()}>
                      {state().axes[index()].degrees.toFixed(2)}
                      <small>°</small>
                    </output>
                    <span>
                      {state().axes[index()].minimum}° to {state().axes[index()].maximum}°
                    </span>
                  </div>
                )}
              </For>
            </div>
            <div class="control-area">
              <div class="dpad">
                <For each={directions}>
                  {(direction) =>
                    direction ? (
                      <Jog pan={direction[1]} tilt={direction[2]} label={`Hold ${direction[0]}`}>
                        {direction[3]}
                      </Jog>
                    ) : (
                      <button
                        disabled={!canTarget()}
                        onClick={() => target('center')}
                        title="Move to referenced zero"
                      >
                        0°
                      </button>
                    )
                  }
                </For>
              </div>
              <div class="jog-note">
                <h3>Hold to move</h3>
                <label>
                  Jog speed
                  <select
                    value={jogSpeed()}
                    onChange={(e) => setJogSpeed(Number(e.currentTarget.value))}
                  >
                    <option value="0.25">25 %</option>
                    <option value="0.5">50 %</option>
                    <option value="1">100 %</option>
                  </select>
                </label>
                <p>Corners move both axes together. Release to decelerate.</p>
                <p class="hint">
                  Wait for motion to finish before changing direction. Leaving this window latches
                  STOP.
                </p>
              </div>
            </div>
            <div class="fields">
              {num('Target pan °', pan, setPan, state().axes[0].minimum, state().axes[0].maximum)}
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
              disabled={!canTarget() || !Number.isFinite(pan() + tilt()) || !percent(moveSpeed())}
              onClick={() => target('move', { pan: pan(), tilt: tilt() })}
            >
              Move to target ↗
            </button>
            <p class="hint">
              Pan and tilt arrive together, so the camera travels in a straight line.
              <Show when={caps().retarget}>
                {' '}
                With retargeting, a new target brakes smoothly and then goes to the newest one.
              </Show>
            </p>
            <div class="nudge">
              <label>
                Step
                <select value={step()} onChange={(e) => setStep(Number(e.currentTarget.value))}>
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
          </section>
          <section class="panel presets">
            <p class="section-number">03 / RECALL</p>
            <h2>Camera positions</h2>
            <p class="hint">
              <b>Save</b> stores the target angles above while released.
              <Show when={caps().saveHere}>
                {' '}
                <b>Here</b> stores the present pose, also while armed; flash is written when the
                coils are released.
              </Show>{' '}
              Recall after reference and arm.
            </p>
            <Show when={caps().presetNames}>
              <label>
                Name for the next save
                <input
                  type="text"
                  maxlength="16"
                  value={presetName()}
                  placeholder="Optional; empty keeps a slot's name"
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
          </section>
        </div>
        <Show when={caps().scales}>
          <section class="settings panel feel">
            <div>
              <p class="section-number">04 / MOTION FEEL</p>
              <h2>Speed, acceleration & smoothness</h2>
              <p class="hint">
                Lowers the configured ceilings for the next moves and jogs. Allowed while armed;
                nothing is saved and no new reference is needed. Now:{' '}
                {Math.round(state().motion.speed * 100)} % ·{' '}
                {Math.round(state().motion.accel * 100)} % · {Math.round(state().motion.jerk * 100)}{' '}
                %.
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
            <p class="section-number">{caps().scales ? '05' : '04'} / MOTION PROFILE</p>
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
