import { createSignal, createEffect, onCleanup } from 'solid-js';
import { joystickVector } from '@camx-pro/control/joystick';

/** Pointer capture owns one gesture; releasing any keyboard chord returns to neutral. */
export function Joystick(props) {
  const [point, setPoint] = createSignal({ x: 0, y: 0 });
  const [held, setHeld] = createSignal(false);
  const [vector, setVector] = createSignal({ pan: 0, tilt: 0 });
  const keys = new Set();
  let pad,
    pointer = null;
  const publish = (x, y) => {
    const length = Math.max(1, Math.hypot(x, y));
    const next = { x: x / length, y: y / length };
    setPoint(next);
    const command = joystickVector(next.x, next.y, props.speed);
    setVector(command);
    props.onVector(command.pan, command.tilt);
  };
  const neutral = () => {
    const id = pointer;
    pointer = null;
    keys.clear();
    const wasHeld = held();
    setHeld(false);
    setPoint({ x: 0, y: 0 });
    setVector({ pan: 0, tilt: 0 });
    if (id !== null && pad?.hasPointerCapture(id)) pad.releasePointerCapture(id);
    if (wasHeld) props.onRelease();
  };
  const position = (event) => {
    const rect = pad.getBoundingClientRect();
    const radius = rect.width * 0.36;
    publish(
      (event.clientX - rect.left - rect.width / 2) / radius,
      (event.clientY - rect.top - rect.height / 2) / radius,
    );
  };
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const keyboardVector = () => {
    const values = [...keys].map((key) => arrows[key]);
    publish(
      values.reduce((sum, v) => sum + v[0], 0),
      values.reduce((sum, v) => sum + v[1], 0),
    );
  };
  createEffect(
    () => props.disabled,
    (disabled) => {
      if (disabled) neutral();
    },
  );
  createEffect(
    () => props.reset,
    () => neutral(),
  );
  createEffect(
    () => props.speed,
    () => {
      if (held()) publish(point().x, point().y);
    },
  );
  const lostWindow = () => neutral();
  const visibility = () => {
    if (document.hidden) neutral();
  };
  window.addEventListener('blur', lostWindow);
  window.addEventListener('resize', lostWindow);
  document.addEventListener('visibilitychange', visibility);
  onCleanup(() => {
    neutral();
    window.removeEventListener('blur', lostWindow);
    window.removeEventListener('resize', lostWindow);
    document.removeEventListener('visibilitychange', visibility);
  });
  return (
    <div class="joystick">
      <div class="joystick-stage">
        <span class="axis-label axis-top" aria-hidden="true">
          Tilt +
        </span>
        <span class="axis-label axis-left" aria-hidden="true">
          Pan −
        </span>
        <span class="axis-label axis-right" aria-hidden="true">
          Pan +
        </span>
        <span class="axis-label axis-bottom" aria-hidden="true">
          Tilt −
        </span>
        <button
          ref={pad}
          type="button"
          class="joystick-pad"
          classList={{ held: held() }}
          aria-label="Pan and tilt joystick"
          aria-roledescription="joystick"
          aria-describedby="joystick-help joystick-state"
          disabled={props.disabled}
          onPointerDown={(event) => {
            if (
              props.disabled ||
              props.blocked ||
              pointer !== null ||
              !event.isPrimary ||
              event.button !== 0
            )
              return;
            event.preventDefault();
            keys.clear();
            pad.focus({ preventScroll: true });
            pointer = event.pointerId;
            pad.setPointerCapture(pointer);
            setHeld(true);
            position(event);
          }}
          onPointerMove={(event) => {
            if (event.pointerId !== pointer) return;
            if (event.pointerType === 'mouse' && event.buttons === 0) {
              neutral();
              return;
            }
            position(event);
          }}
          onPointerUp={(event) => {
            if (event.pointerId === pointer) neutral();
          }}
          onPointerCancel={(event) => {
            if (event.pointerId === pointer) neutral();
          }}
          onLostPointerCapture={(event) => {
            if (event.pointerId === pointer) neutral();
          }}
          onBlur={neutral}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              neutral();
              props.onStop();
              return;
            }
            if (!arrows[event.key]) return;
            event.preventDefault();
            if (event.repeat || pointer !== null || props.disabled || props.blocked) return;
            keys.add(event.key);
            setHeld(true);
            keyboardVector();
          }}
          onKeyUp={(event) => {
            if (!arrows[event.key] || pointer !== null) return;
            event.preventDefault();
            keys.delete(event.key);
            if (!keys.size) neutral();
            else keyboardVector();
          }}
        >
          <svg class="joystick-grid" viewBox="0 0 320 320" aria-hidden="true">
            <circle cx="160" cy="160" r="155" />
            <circle cx="160" cy="160" r="115" />
            <circle cx="160" cy="160" r="75" />
            <circle cx="160" cy="160" r="20" />
            <path d="M160 5v310M5 160h310" />
          </svg>
          <span
            class="joystick-thumb"
            style={{ left: `${50 + point().x * 36}%`, top: `${50 + point().y * 36}%` }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14M12 5v14" />
            </svg>
          </span>
        </button>
      </div>
      <p class="joystick-instruction">Drag to steer. Let go to brake.</p>
      <p class="hint" id="joystick-help">
        Arrow keys also work. Esc stops. Button controls below.
      </p>
      <div class="joystick-vector" aria-label="Requested axis speed">
        <span>
          Pan <output data-testid="joystick-pan">{Math.round(vector().pan * 100)}%</output>
        </span>
        <span>
          Tilt <output data-testid="joystick-tilt">{Math.round(vector().tilt * 100)}%</output>
        </span>
      </div>
      <p class="joystick-state hint" id="joystick-state" role="status">
        {props.message}
      </p>
    </div>
  );
}
