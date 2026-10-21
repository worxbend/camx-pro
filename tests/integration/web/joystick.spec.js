import { test, expect } from '@playwright/test';

const device = async (page) => JSON.parse(await page.locator('#diagnostics').textContent());
const commands = async (request) => (await request.get('/test/commands')).json();
const jogs = async (request) => (await commands(request)).filter((c) => c.op === 'jog');
async function arm(page, request) {
  await request.get('/test/reset');
  await page.goto('/control/');
  await expect(page.getByRole('button', { name: 'Pan and tilt joystick' })).toBeDisabled();
  await page.getByLabel('API token').fill('test-token-123456789');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.status-strip')).toContainText('Released');
  await expect(page.getByRole('button', { name: 'Pan and tilt joystick' })).toBeDisabled();
  await page.getByLabel('I physically aligned both axes.').check();
  await page.locator('#reference').click();
  await page.locator('#arm').click();
  await expect(page.getByRole('button', { name: 'Pan and tilt joystick' })).toBeEnabled();
  return page.getByRole('button', { name: 'Pan and tilt joystick' });
}
async function position(pad) {
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width * 0.36 };
}

test('joystick steers both real C++ axes, scales speed, reverses after braking and releases outside', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pad = await arm(page, request);
  const { x, y, radius } = await position(pad);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + radius * 0.1, y);
  expect(await jogs(request)).toHaveLength(0); // neutral dead zone
  await page.mouse.move(x + radius * 0.5, y);
  await expect
    .poll(async () => (await jogs(request)).some((c) => c.pan > 0 && c.pan < 0.5))
    .toBe(true);
  await page.mouse.move(x + radius * 3, y); // radial clamp outside the pad
  await expect
    .poll(async () => (await jogs(request)).some((c) => c.pan === 0.5 && c.tilt === 0))
    .toBe(true);
  await page.mouse.move(x - radius, y - radius);
  await expect
    .poll(async () => (await jogs(request)).some((c) => c.pan === -0.35 && c.tilt === 0.35))
    .toBe(true);
  await expect.poll(async () => (await device(page)).jogging).toBe(true);
  await page.mouse.move(x - radius * 3, y - radius * 3);
  await page.mouse.up();
  await expect.poll(async () => (await device(page)).moving).toBe(false);
  await expect(page.getByTestId('joystick-pan')).toHaveText('0%');
  await expect(page.getByTestId('joystick-tilt')).toHaveText('0%');
  const state = await device(page);
  expect(state.referenced).toBe(true);
  expect(state.stopped).toBe(false);
  expect((await jogs(request)).at(-1)).toMatchObject({ pan: 0, tilt: 0 });
  expect(errors).toEqual([]);
});

test('joystick release during a delayed accepted jog cancels queued direction and brakes', async ({
  page,
  request,
}) => {
  const pad = await arm(page, request);
  let unlock, accept;
  const gate = new Promise((r) => (unlock = r)),
    accepted = new Promise((r) => (accept = r));
  let delayed = false;
  await page.route('**/api/command', async (route) => {
    const c = route.request().postDataJSON();
    if (!delayed && c.op === 'jog' && (c.pan || c.tilt)) {
      delayed = true;
      const response = await route.fetch();
      accept();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const { x, y, radius } = await position(pad);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + radius, y);
  await accepted;
  await page.mouse.move(x - radius, y);
  await page.mouse.up();
  unlock();
  await expect.poll(async () => (await jogs(request)).at(-1)?.pan).toBe(0);
  await expect.poll(async () => (await device(page)).moving).toBe(false);
  expect((await jogs(request)).some((c) => c.pan < 0)).toBe(false);
  await expect(page.getByTestId('joystick-pan')).toHaveText('0%');
});

test('joystick keyboard chords steer diagonally, focus loss brakes, and Escape sends one STOP', async ({
  page,
  request,
}) => {
  const pad = await arm(page, request);
  await pad.focus();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => (await jogs(request)).some((c) => c.pan > 0 && c.tilt > 0))
    .toBe(true);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowUp');
  await expect.poll(async () => (await device(page)).moving).toBe(false);
  await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await device(page)).jogging).toBe(true);
  await page.keyboard.press('Tab');
  await page.keyboard.up('ArrowLeft');
  await expect.poll(async () => (await device(page)).moving).toBe(false);
  await pad.focus();
  await page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await device(page)).jogging).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowDown');
  await expect(page.locator('.status-strip')).toContainText('STOP latched');
  expect((await commands(request)).filter((c) => c.op === 'stop')).toHaveLength(1);
  await expect(pad).toBeDisabled();
  await expect(page.getByTestId('joystick-tilt')).toHaveText('0%');
});

test('joystick lost pointer capture brakes and window blur latches STOP', async ({
  page,
  request,
}) => {
  const pad = await arm(page, request);
  await pad.evaluate((element) =>
    element.addEventListener('pointerdown', (e) => (element.dataset.pointerId = e.pointerId)),
  );
  const { x, y, radius } = await position(pad);
  await page.mouse.move(x + radius, y);
  await page.mouse.down();
  await expect.poll(async () => (await device(page)).jogging).toBe(true);
  await pad.evaluate((element) => element.releasePointerCapture(Number(element.dataset.pointerId)));
  await page.mouse.move(x + radius / 2, y);
  await page.mouse.up();
  await expect.poll(async () => (await device(page)).moving).toBe(false);
  await page.mouse.move(x, y - radius);
  await page.mouse.down();
  await expect.poll(async () => (await device(page)).jogging).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(page.locator('.status-strip')).toContainText('STOP latched');
  await expect(page.getByTestId('joystick-pan')).toHaveText('0%');
});

test('joystick touch drag works at phone width and touch cancellation releases the axes', async ({
  browser,
  request,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const pad = await arm(page, request);
  const { x, y, radius } = await position(pad);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + radius * 0.7, y: y - radius * 0.7 }],
  });
  await expect.poll(async () => (await device(page)).jogging).toBe(true);
  expect((await jogs(request)).some((c) => c.pan > 0 && c.tilt > 0)).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(async () => (await device(page)).moving).toBe(false);
  await expect(page.getByTestId('joystick-pan')).toHaveText('0%');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await context.close();
});
