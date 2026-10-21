import { test, expect } from '@playwright/test';

test('microsite renders real CAD, switches modes, shares poses and exports a render', async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/camx-pro/');
  await expect(page).toHaveTitle('CAMX Pro — Static is overrated.');
  await expect(page.getByRole('heading', { name: 'Static is overrated.' })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('#hero-scene')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  const canvas = page.locator('#hero-scene canvas');
  const original = await canvas.evaluate((element) => element.toDataURL());
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  expect(await canvas.evaluate((element) => element.toDataURL())).not.toBe(original);
  await page.getByRole('button', { name: 'X-ray', exact: true }).click();
  await expect(page.getByRole('button', { name: 'X-ray', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await canvas.evaluate((element) => element.toDataURL())).not.toBe(original);
  await page.getByRole('button', { name: 'Exploded', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exploded', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exterior', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#inside').scrollIntoViewIfNeeded();
  await expect(page.locator('#inside-scene')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  // The second stage clones the cached CAD instead of fetching another 14 MB model.
  expect(requests.filter((url) => url.endsWith('.glb'))).toHaveLength(1);
  await page.locator('#pan').fill('12');
  await page.locator('#tilt').fill('-7');
  await expect(page.locator('#pan-value')).toHaveText('12°');
  await expect(page.locator('#tilt-value')).toHaveText('-7°');
  await page.getByRole('button', { name: 'Lilac finish' }).click();
  await page.getByRole('button', { name: 'Share this angle' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const shared = await page.getByLabel('Preview link').inputValue();
  expect(new URL(shared).searchParams.get('pan')).toBe('12');
  expect(new URL(shared).searchParams.get('tilt')).toBe('-7');
  expect(new URL(shared).searchParams.get('finish')).toBe('lilac');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Share this angle' })).toBeFocused();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a render' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('camx-pro-lilac-12--7.png');
  expect(await download.failure()).toBeNull();
  await page.goto(shared);
  await expect(page.locator('#hero-scene')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await expect(page.locator('#pan')).toHaveValue('12');
  await expect(page.locator('#tilt')).toHaveValue('-7');
  await expect(page.getByRole('button', { name: 'Lilac finish' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Play with the rig' }).click();
  await expect(page.locator('#diagonal-play')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('#pan').inputValue()).not.toBe('12');
  await page.getByRole('button', { name: 'Play with the rig' }).click();
  await expect(page.locator('#diagonal-play')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('microsite is responsive, keyboard accessible and respects reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/camx-pro/?pan=Infinity&tilt=-999&view=invalid&finish=invalid');
  await expect(page.locator('#hero-scene')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await expect(page.locator('#pan')).toHaveValue('0');
  await expect(page.locator('#tilt')).toHaveValue('-15');
  await page.getByRole('button', { name: 'Play with the rig' }).click();
  await expect(page.locator('#pan')).toHaveValue('18');
  await expect(page.locator('#tilt')).toHaveValue('12');
  await expect(page.locator('#studio-message')).toContainText('reduced-motion');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.locator('summary').filter({ hasText: 'Tilt without the tangle.' }).click();
  await expect(page.getByText('A hidden 2:1 belt drive', { exact: false })).toBeVisible();
  await expect(page.getByText('A 4:1 planetary reduction', { exact: false })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Download the build kit' })).toHaveAttribute(
    'href',
    'downloads/camx-pro-prototype.zip',
  );
  await expect(page.getByRole('link', { name: 'Browser demo' })).toHaveAttribute(
    'href',
    'control/?demo=1',
  );
});

test('microsite model download failure can recover through Retry', async ({ page }) => {
  let unavailable = true;
  await page.route('**/camx-pro.glb', (route) =>
    unavailable ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(),
  );
  await page.goto('/camx-pro/');
  const stage = page.locator('#hero-scene');
  await expect(stage.getByAltText('CAMX Pro assembly preview')).toBeVisible();
  await expect(stage.getByText('3D preview unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play with the rig' })).toBeDisabled();
  unavailable = false;
  await stage.getByRole('button', { name: 'Retry 3D preview' }).click();
  await expect(stage).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Play with the rig' })).toBeEnabled();
});

test('microsite keeps build resources available without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.includes('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/camx-pro/');
  await expect(page.locator('#hero-scene').getByAltText('CAMX Pro assembly preview')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download the build kit' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play with the rig' })).toBeDisabled();
});

test('viewer loads actual 103-part assembly and all modes, joints and mobile controls work', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/camx-pro/viewer.html');
  await page.waitForFunction(() => window.camx?.ready);
  expect(await page.evaluate(() => window.camx.parts.size)).toBe(103);
  await page.getByRole('button', { name: 'Planetary', exact: true }).click();
  await page.locator('#pan').fill('45');
  await page.locator('#tilt').fill('30');
  expect(await page.evaluate(() => [camx.state.mode, camx.state.pan, camx.state.tilt])).toEqual([
    'actuator',
    45,
    30,
  ]);
  await page.getByRole('button', { name: 'X-ray', exact: true }).click();
  await page.locator('#explode').fill('40');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Exterior', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('viewer gives useful fallback without WebGL and for missing model', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.includes('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/camx-pro/viewer.html');
  await expect(page.locator('#scene-state')).toHaveText('Static preview');
  await expect(page.getByAltText('CAD assembly preview')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assembly STEP' })).toBeVisible();
});

test('Solid remote controls actual C++ firmware: reference, geared move, jog release, STOP and presets', async ({
  page,
  request,
}) => {
  await request.get('/test/reset');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/control/');
  await page.locator('#precision-controls > summary').click();
  await page.locator('#motion-settings > summary').click();
  await page.getByLabel('API token').fill('test-token-123456789');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.status-strip')).toContainText('Released');
  await expect(page.locator('#arm')).toBeDisabled();
  await page.getByLabel('I physically aligned both axes.').check();
  await page.locator('#reference').click();
  await expect(page.locator('#arm')).toBeEnabled();
  await page.locator('#arm').click();
  await expect(page.locator('.status-strip')).toContainText('Armed');
  await page.getByLabel('Target pan °', { exact: true }).fill('1');
  await page.getByLabel('Target tilt °', { exact: true }).fill('-1');
  await page.locator('#move').click();
  await expect
    .poll(async () =>
      JSON.parse(await page.locator('#diagnostics').textContent()).axes.map((a) => a.steps),
    )
    .toEqual([46, -23]);
  await expect(page.getByRole('button', { name: 'Hold pan right' })).toBeEnabled();
  const jog = page.getByRole('button', { name: 'Hold pan right' });
  await jog.scrollIntoViewIfNeeded();
  const b = await jog.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => JSON.parse(await page.locator('#diagnostics').textContent()).jogging)
    .toBe(true);
  await page.mouse.up();
  await expect
    .poll(async () => JSON.parse(await page.locator('#diagnostics').textContent()).moving)
    .toBe(false);
  await page.getByRole('button', { name: /STOP/ }).click();
  await expect(page.locator('.status-strip')).toContainText('STOP latched');
  await page.locator('#disarm').click();
  await page.getByRole('button', { name: 'Save position 1', exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await page.locator('#diagnostics').textContent()).presets[0].valid)
    .toBe(true);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.getByLabel('API token').inputValue()).toBe('');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/remote-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  const commands = await (await request.get('/test/commands')).json();
  expect(commands.some((c) => c.op === 'jog' && c.pan === 0 && c.tilt === 0)).toBe(true);
});

test('Solid remote uses firmware 1.1 features on the C++ controller: diagonals, feel, retarget, named presets, last pose', async ({
  page,
  request,
}) => {
  await request.get('/test/reset');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const device = async () => JSON.parse(await page.locator('#diagnostics').textContent());
  const commands = async () => (await request.get('/test/commands')).json();
  const idle = () => expect.poll(async () => (await device()).moving).toBe(false);
  await page.goto('/control/');
  await page.locator('#precision-controls > summary').click();
  await page.locator('#motion-settings > summary').click();
  await page.getByLabel('API token').fill('test-token-123456789');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.status-strip')).toContainText('Released');
  await page.getByLabel('I physically aligned both axes.').check();
  await page.locator('#reference').click();
  await expect(page.locator('#arm')).toBeEnabled();
  await page.locator('#arm').click();
  await expect(page.locator('.status-strip')).toContainText('Armed');

  // Motion feel: a runtime scale, applied while armed, keeps the reference.
  await page.getByLabel('Speed %', { exact: true }).fill('50');
  await page.locator('#apply-feel').click();
  await expect.poll(async () => (await device()).motion.speed).toBe(0.5);
  expect((await device()).referenced).toBe(true);
  await page.getByLabel('Speed %', { exact: true }).fill('100');
  await page.locator('#apply-feel').click();
  await expect.poll(async () => (await device()).motion.speed).toBe(1);

  // A diagonal step moves both axes in one synchronized relative move.
  await page.getByRole('button', { name: 'Step up-right' }).click();
  await expect.poll(async () => (await device()).axes.map((a) => a.steps)).toEqual([46, 23]);
  expect((await commands()).some((c) => c.op === 'relative' && c.pan === 1 && c.tilt === 1)).toBe(
    true,
  );

  // A held diagonal jogs both axes at once and stops smoothly on release.
  const corner = page.getByRole('button', { name: 'Hold down-left' });
  await corner.scrollIntoViewIfNeeded();
  const box = await corner.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await device()).jogging).toBe(true);
  await page.waitForTimeout(700);
  await page.mouse.up();
  await idle();
  const [panSteps, tiltSteps] = (await device()).axes.map((a) => a.steps);
  expect(panSteps).toBeLessThan(46);
  expect(tiltSteps).toBeLessThan(23);
  expect((await commands()).some((c) => c.op === 'jog' && c.pan === -0.5 && c.tilt === -0.5)).toBe(
    true,
  );

  // Retargeting: a new target while moving brakes, then goes to the newest one.
  await page.getByLabel('Target pan °', { exact: true }).fill('8');
  await page.getByLabel('Target tilt °', { exact: true }).fill('0');
  await page.locator('#move').click();
  await expect.poll(async () => (await device()).moving).toBe(true);
  await expect(page.locator('#move')).toBeDisabled();
  await page.getByLabel('Retarget while moving').check();
  await expect(page.locator('#move')).toBeEnabled();
  await page.getByLabel('Target pan °', { exact: true }).fill('-3');
  await page.locator('#move').click();
  await expect
    .poll(async () => (await device()).axes.map((a) => a.steps), { timeout: 20000 })
    .toEqual([Math.round((-3 * 4096 * 4) / 360), 0]);
  expect((await commands()).some((c) => c.op === 'move' && c.pan === -3 && c.retarget)).toBe(true);
  await page.getByLabel('Retarget while moving').uncheck();

  // Named preset of the present pose, saved while armed, then cleared.
  await page.getByLabel('Name for the next save').fill('Desk');
  await page.getByRole('button', { name: 'Save current pose as position 2' }).click();
  await expect.poll(async () => (await device()).presets[1].name).toBe('Desk');
  await expect(page.locator('.preset-list')).toContainText('Desk');
  await expect(page.locator('.preset-list')).toContainText('-3.0° / 0.0°');
  await page.getByRole('button', { name: 'Clear position 2' }).click();
  await expect.poll(async () => (await device()).presets[1].valid).toBe(false);

  // Releasing at rest leaves a last-pose hint that can fill the reference angles.
  await page.locator('#disarm').click();
  await expect(page.locator('.status-strip')).toContainText('Released');
  await page.locator('#use-last-pose').click();
  const reference = Number(await page.getByLabel('Actual pan °').inputValue());
  expect(Math.abs(reference + 3)).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test('remote demo is clearly labeled and blur stops an owned session', async ({ page }) => {
  await page.goto('/camx-pro/control/?demo=1');
  await expect(page.locator('.banner')).toContainText('No hardware');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('I physically aligned both axes.').check();
  await page.locator('#reference').click();
  await page.locator('#arm').click();
  await expect(page.locator('.status-strip')).toContainText('Armed');
  await page.screenshot({ path: 'test-results/remote-desktop.png', fullPage: true });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.status-strip')).toContainText('STOP latched');
});

test('missing model presents a retry message and keeps manufacturing links', async ({ page }) => {
  await page.route('**/downloads/assembly/camx-pro.glb', (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  await page.goto('/camx-pro/viewer.html');
  await expect(page.locator('#scene-state')).toHaveText('Build not loaded');
  await expect(page.locator('#loading')).toContainText('reload to retry');
  await expect(page.getByRole('link', { name: 'Assembly STEP' })).toBeVisible();
});
