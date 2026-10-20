import { createSignal, For, Show, onCleanup } from 'solid-js';
import { render } from '@solidjs/web';
import { Session, httpTransport } from '@camx/control';
import { demoTransport, initialState } from '@camx/control/demo';
import './style.css';

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
  const [speed, setSpeed] = createSignal(4),
    [acceleration, setAcceleration] = createSignal(8);
  let session;
  const state = () => snapshot().state;
  const busy = () => snapshot().busy || !snapshot().connected;
  const canMove = () =>
    !busy() &&
    snapshot().owned &&
    state().armed &&
    state().referenced &&
    !state().stopped &&
    !state().moving;
  const update = (current) =>
    setSnapshot({
      state: current.state || initialState(),
      connected: current.connected,
      busy: current.busy,
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
  const num = (label, value, set, min, max) => (
    <label>
      {label}
      <input
        type="number"
        value={value()}
        min={min}
        max={max}
        step="0.1"
        onInput={(e) => set(e.currentTarget.value === '' ? NaN : Number(e.currentTarget.value))}
      />
    </label>
  );
  function Jog(props) {
    const start = () => act(() => session?.beginJog(props.pan, props.tilt));
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
            {!snapshot().connected
              ? 'Disconnected'
              : state().stopped
                ? 'STOP latched'
                : state().moving
                  ? 'Moving'
                  : state().armed
                    ? 'Armed · holding'
                    : 'Released'}
          </strong>
          <span>
            {state().referenced ? 'Open-loop position estimate' : 'Position unreferenced'}
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
                <div />
                <Jog pan={0} tilt={0.5} label="Hold tilt up">
                  ↑
                </Jog>
                <div />
                <Jog pan={-0.5} tilt={0} label="Hold pan left">
                  ←
                </Jog>
                <button
                  disabled={!canMove()}
                  onClick={() => command('center')}
                  title="Move to referenced zero"
                >
                  0°
                </button>
                <Jog pan={0.5} tilt={0} label="Hold pan right">
                  →
                </Jog>
                <div />
                <Jog pan={0} tilt={-0.5} label="Hold tilt down">
                  ↓
                </Jog>
                <div />
              </div>
              <div class="jog-note">
                <h3>Hold to move</h3>
                <p>
                  Half configured speed.
                  <br />
                  Release to decelerate.
                </p>
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
            <button
              id="move"
              class="primary"
              disabled={!canMove() || !Number.isFinite(pan() + tilt())}
              onClick={() => command('move', { pan: pan(), tilt: tilt() })}
            >
              Move to target ↗
            </button>
            <div class="nudge">
              <label>
                Step
                <select value={step()} onChange={(e) => setStep(Number(e.currentTarget.value))}>
                  <option value="0.1">0.1°</option>
                  <option value="1">1°</option>
                  <option value="5">5°</option>
                </select>
              </label>
              <For
                each={[
                  ['Pan −', -1, 0],
                  ['Pan +', 1, 0],
                  ['Tilt −', 0, -1],
                  ['Tilt +', 0, 1],
                ]}
              >
                {([name, p, t]) => (
                  <button
                    disabled={!canMove()}
                    onClick={() => command('relative', { pan: p * step(), tilt: t * step() })}
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
              Save the explicit target angles above while released. Recall after reference and arm.
            </p>
            <div class="preset-list">
              <For each={state().presets}>
                {(preset, index) => (
                  <div class="preset">
                    <span class="slot">{String(index() + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>Position {index() + 1}</strong>
                      <small>
                        {preset.valid
                          ? `${preset.pan.toFixed(1)}° / ${preset.tilt.toFixed(1)}°`
                          : 'Empty slot'}
                      </small>
                    </div>
                    <button
                      aria-label={`Save position ${index() + 1}`}
                      disabled={busy() || state().armed || !Number.isFinite(pan() + tilt())}
                      onClick={() =>
                        command('preset_set', { slot: index(), pan: pan(), tilt: tilt() })
                      }
                    >
                      Save
                    </button>
                    <button
                      aria-label={`Recall position ${index() + 1}`}
                      disabled={!canMove() || !preset.valid}
                      onClick={() => command('preset_move', { slot: index() })}
                    >
                      Go
                    </button>
                  </div>
                )}
              </For>
            </div>
          </section>
        </div>
        <section class="settings panel">
          <div>
            <p class="section-number">04 / MOTION PROFILE</p>
            <h2>Speed & acceleration</h2>
            <p class="hint">
              Applies to both axes while released; requires a fresh reference. Travel limits and
              gear calibration remain device settings.
            </p>
          </div>
          <div class="fields">
            {num('Speed °/s', speed, setSpeed, 0.1, 8)}
            {num('Acceleration °/s²', acceleration, setAcceleration, 0.1, 20)}
            <button
              disabled={busy() || state().armed || !Number.isFinite(speed() + acceleration())}
              onClick={() =>
                command('settings', {
                  pan_speed: speed(),
                  tilt_speed: speed(),
                  pan_accel: acceleration(),
                  tilt_accel: acceleration(),
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
