import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('bridge CLI uses only project-scoped device and port configuration', async (t) => {
  const requests = [];
  const device = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  t.after(() => {
    device.closeAllConnections();
    device.close();
  });
  device.listen(0, '127.0.0.1');
  await once(device, 'listening');
  const deviceUrl = `http://127.0.0.1:${device.address().port}`;
  const directory = await mkdtemp(path.join(tmpdir(), 'camx-pro-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const configured of [false, true]) {
    await t.test(configured ? 'explicit Pro device' : 'unrelated device is ignored', async (t) => {
      const env = {
        ...process.env,
        CAMX_DEVICE_URL: deviceUrl,
        PORT: 'invalid-unrelated-port',
        CAMX_PRO_PORT: '0',
      };
      delete env.CAMX_PRO_DEVICE_URL;
      if (configured) env.CAMX_PRO_DEVICE_URL = deviceUrl;
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        {
          cwd: directory,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const exited = once(child, 'exit');
      t.after(async () => {
        child.kill();
        await exited;
      });
      const base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Bridge startup timed out')), 5000);
        let output = '';
        let errors = '';
        child.stderr.on('data', (chunk) => (errors += chunk));
        child.once('error', reject);
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(Error(`Bridge exited (${code}): ${errors}`));
        });
        child.stdout.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/Remote: (http:\/\/127\.0\.0\.1:\d+)\/control\//);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      const response = await fetch(`${base}/api/state`, {
        headers: { Authorization: 'Bearer test-token-123456' },
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, configured ? 200 : 503);
      assert.deepEqual(requests, configured ? ['/api/state'] : []);
    });
  }
});
