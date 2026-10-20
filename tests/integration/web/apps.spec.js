import { test, expect } from '@playwright/test';

test('project page works at GitHub project prefix and loads CAD only on demand', async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/camx-pro/');
  await expect(page.getByRole('heading', { name: /A new angle/ })).toBeVisible();
  expect(requests.some((u) => u.endsWith('.glb'))).toBe(false);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: 'test-results/project-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Load interactive preview' }).click();
  await page
    .frameLocator('iframe')
    .locator('#scene-state')
    .filter({ hasText: 'REV P3' })
    .waitFor({ timeout: 30000 });
  expect(errors).toEqual([]);
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
