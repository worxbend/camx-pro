import '@fontsource/anton/latin-400.css';
import './landing.css';
import { StudioScene } from './studio-scene.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const numberParam = (name, min, max) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : 0;
};
const state = {
  pan: numberParam('pan', -20, 20),
  tilt: numberParam('tilt', -15, 15),
  mode: ['exterior', 'xray', 'exploded'].includes(params.get('view'))
    ? params.get('view')
    : 'exterior',
  finish: ['graphite', 'clay', 'lilac'].includes(params.get('finish'))
    ? params.get('finish')
    : 'graphite',
};
let hero,
  inside,
  frame,
  playing = false,
  animationStart = null,
  previous = 0,
  startPose;
const stages = new Map();
const interactive = document.querySelectorAll(
  '[data-mode], [data-finish], #hero-reset, #hero-play, #pan, #tilt, #diagonal-play, #share-pose, #save-image',
);

function sync() {
  hero?.update(state);
  inside?.update({ ...state, mode: 'exploded' });
  for (const axis of ['pan', 'tilt']) {
    $(axis).value = state[axis];
    $(axis + '-value').textContent = `${state[axis]}°`;
    $(axis).setAttribute('aria-valuetext', `${state[axis]} degrees`);
  }
  document
    .querySelectorAll('[data-mode]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(state.mode === button.dataset.mode)),
    );
  document
    .querySelectorAll('[data-finish]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(state.finish === button.dataset.finish)),
    );
  $('finish-label').textContent = state.finish[0].toUpperCase() + state.finish.slice(1);
}

function stop() {
  playing = false;
  animationStart = null;
  cancelAnimationFrame(frame);
  $('diagonal-play').querySelector('span').textContent = 'Play diagonal';
  $('diagonal-play').setAttribute('aria-pressed', 'false');
  $('hero-play').setAttribute('aria-pressed', 'false');
}

function animate(time) {
  if (!playing) return;
  if (document.hidden || (!hero?.visible && !inside?.visible)) {
    stop();
    return;
  }
  if (animationStart === null) animationStart = time;
  const progress = Math.min((time - animationStart) / 5500, 1);
  // A single gentle sweep and return, explicitly a visual preview, not the firmware planner.
  if (time - previous >= 1000 / 30 || progress === 1) {
    const sweep = Math.sin(progress * Math.PI * 2);
    state.pan = Math.round(startPose.pan * (1 - Math.sin(progress * Math.PI)) + 18 * sweep);
    state.tilt = Math.round(startPose.tilt * (1 - Math.sin(progress * Math.PI)) + 12 * sweep);
    state.pan = Math.max(-20, Math.min(20, state.pan));
    state.tilt = Math.max(-15, Math.min(15, state.tilt));
    sync();
    previous = time;
  }
  if (progress === 1) {
    state.pan = startPose.pan;
    state.tilt = startPose.tilt;
    stop();
    sync();
    return;
  }
  frame = requestAnimationFrame(animate);
}

function play() {
  if (playing) {
    stop();
    return;
  }
  if (reducedMotion.matches) {
    state.pan = state.pan === 18 ? 0 : 18;
    state.tilt = state.tilt === 12 ? 0 : 12;
    sync();
    $('studio-message').textContent =
      'Pose updated instantly to respect your reduced-motion preference.';
    return;
  }
  startPose = { pan: state.pan, tilt: state.tilt };
  playing = true;
  animationStart = null;
  previous = 0;
  $('diagonal-play').querySelector('span').textContent = 'Pause preview';
  $('diagonal-play').setAttribute('aria-pressed', 'true');
  $('hero-play').setAttribute('aria-pressed', 'true');
  frame = requestAnimationFrame(animate);
}

async function loadStage(id, exploded = false) {
  const element = $(id);
  const status = element.querySelector('.scene-status');
  stages.get(id)?.dispose();
  element.querySelector('.scene-fallback')?.remove();
  element.classList.remove('is-fallback');
  status.hidden = false;
  status.textContent = 'Loading the real CAD assembly · 14 MB…';
  const stage = new StudioScene(element, { exploded });
  stages.set(id, stage);
  try {
    await stage.load();
    if (exploded) inside = stage;
    else {
      hero = stage;
      interactive.forEach((control) => {
        control.disabled = false;
      });
      // Reuse the live assembly render instead of loading a third WebGL context.
      const image = $('build-render');
      image.src = stage.snapshot();
      image.dataset.rendered = 'true';
    }
    sync();
  } catch {
    stage.dispose();
    element.classList.add('is-fallback');
    const preview = document.createElement('img');
    preview.className = 'scene-fallback';
    preview.src = exploded
      ? './downloads/images/exploded.png'
      : './downloads/images/three_quarter.png';
    preview.alt = exploded ? 'Exploded P3 assembly preview' : 'CAMX Pro assembly preview';
    element.prepend(preview);
    status.textContent = '3D preview unavailable. Build files are still ready.';
    const retry = document.createElement('button');
    retry.className = 'text-button';
    retry.textContent = 'Retry 3D preview';
    retry.addEventListener('click', () => loadStage(id, exploded));
    status.append(retry);
  }
}

for (const axis of ['pan', 'tilt'])
  $(axis).addEventListener('input', (event) => {
    stop();
    state[axis] = Number(event.target.value);
    sync();
  });
document.querySelectorAll('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    sync();
  }),
);
document.querySelectorAll('[data-finish]').forEach((button) =>
  button.addEventListener('click', () => {
    state.finish = button.dataset.finish;
    sync();
  }),
);
$('hero-play').addEventListener('click', play);
$('diagonal-play').addEventListener('click', play);
$('hero-reset').addEventListener('click', () => {
  stop();
  Object.assign(state, { pan: 0, tilt: 0, mode: 'exterior' });
  sync();
  hero.resetCamera();
  inside?.resetCamera();
});
$('save-image').addEventListener('click', () => {
  stop();
  const anchor = document.createElement('a');
  anchor.download = `camx-pro-${state.finish}-${state.pan}-${state.tilt}.png`;
  anchor.href = hero.snapshot();
  anchor.click();
  $('studio-message').textContent = 'Your PNG render is ready. The background is transparent.';
});
$('share-pose').addEventListener('click', () => {
  stop();
  const url = new URL(location.href);
  url.search = new URLSearchParams({
    pan: state.pan,
    tilt: state.tilt,
    view: state.mode,
    finish: state.finish,
  }).toString();
  url.hash = 'rig';
  $('share-url').value = url.href;
  $('copy-status').textContent = '';
  $('share-dialog').showModal();
});
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('share-url').value);
    $('copy-status').textContent = 'Copied. Go make someone look.';
  } catch {
    $('share-url').focus();
    $('share-url').select();
    $('copy-status').textContent = 'Select and copy the link above.';
  }
});
$('share-dialog').addEventListener('click', (event) => {
  if (event.target === $('share-dialog')) $('share-dialog').close();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else {
    hero?.render();
    inside?.render();
  }
});
reducedMotion.addEventListener('change', stop);
const lazyStage = new IntersectionObserver(
  ([entry]) => {
    if (entry.isIntersecting) {
      lazyStage.disconnect();
      loadStage('inside-scene', true);
    }
  },
  { rootMargin: '150px' },
);
lazyStage.observe($('inside-scene'));
sync();
loadStage('hero-scene');
