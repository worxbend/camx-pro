import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createControlServer, privateAddress } from '../src/server.mjs';
const start = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
test('private address allowlist excludes public and ambiguous forms', () => {
  for (const ip of ['127.0.0.1', '192.168.5.2', '10.1.2.3', '172.16.1.2', '::1', 'fd00::1'])
    assert(privateAddress(ip));
  for (const ip of ['8.8.8.8', '172.32.0.1', 'example.com', '::ffff:8.8.8.8', '192.168.1.999'])
    assert(!privateAddress(ip));
});
test('bridge forwards exact API bytes and rejects foreign origins, routes and oversized requests', async () => {
  const received = [];
  const device = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ url: req.url, body, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  const dp = await start(device);
  const bridge = await createControlServer({ deviceUrl: `http://127.0.0.1:${dp}` });
  const bp = await start(bridge);
  const base = `http://127.0.0.1:${bp}`,
    headers = {
      Authorization: 'Bearer test-token-123456',
      'X-CAMX-Request': '1',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal(
      (await fetch(base + '/api/command', { method: 'POST', headers, body: '{"op":"stop"}' }))
        .status,
      200,
    );
    assert.equal(received[0].body, '{"op":"stop"}');
    assert.equal(received[0].auth, headers.Authorization);
    assert.equal(
      (
        await fetch(base + '/api/state', {
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    const forged = await new Promise((resolve) => {
      const req = http.request(
        base + '/api/state',
        { headers: { ...headers, Host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    });
    assert.equal(forged, 403);
    assert.equal((await fetch(base + '/api/state?token=secret', { headers })).status, 400);
    assert.equal(
      (
        await fetch(base + '/api/command', {
          method: 'POST',
          headers: { Authorization: headers.Authorization },
          body: '{}',
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(base + '/api/command', { method: 'POST', headers, body: 'x'.repeat(769) }))
        .status,
      413,
    );
    assert.equal((await fetch(base + '/unexpected', { headers })).status, 404);
    assert.equal(received.length, 1);
  } finally {
    await close(bridge);
    await close(device);
  }
});
test('URL cannot carry credentials, paths, fragments or non-HTTP protocols', async () => {
  for (const url of [
    'http://user:pass@localhost',
    'http://localhost/path',
    'http://localhost#secret',
    'file:///tmp',
  ])
    await assert.rejects(createControlServer({ deviceUrl: url }));
});
