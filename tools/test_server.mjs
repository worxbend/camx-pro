/** Local-only browser fixture: static Pages prefix plus the real portable C++ controller. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
const directory = mkdtempSync(join(tmpdir(), 'camx-app-test-'));
const binary = join(directory, 'controller');
execFileSync(process.env.CXX || 'clang++', [
  '-std=c++17',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-Ifirmware/include',
  'firmware/tests/simulator.cpp',
  '-o',
  binary,
]);
const contract = JSON.parse(readFileSync('contracts/state-v1.json', 'utf8'));
assert.deepEqual(
  JSON.parse(execFileSync(binary, { input: '{"op":"state"}\n', encoding: 'utf8' })),
  contract,
  'Regenerate the shared contract fixture after firmware API changes',
);
let child,
  pending = [],
  commands = [];
function reset() {
  child?.kill();
  pending = [];
  commands = [];
  child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: child.stdout }).on('line', (line) =>
    pending.shift()?.(JSON.parse(line)),
  );
}
reset();
const exchange = (body) =>
  new Promise((resolve) => {
    pending.push(resolve);
    child.stdin.write(JSON.stringify(body) + '\n');
  });
const root = resolve('apps/site/dist');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/test/reset') {
    reset();
    res.end('ok');
    return;
  }
  if (path === '/test/commands') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(commands));
    return;
  }
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-token-123456789') {
      res.writeHead(401);
      res.end('{"error":"unauthorized"}');
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const c = req.method === 'GET' ? { op: 'state' } : JSON.parse(body);
    commands.push(c);
    const state = await exchange(c);
    res.writeHead(state.result === 'ok' ? 200 : 409);
    res.end(JSON.stringify(state));
    return;
  }
  let relative = path.startsWith('/camx-pro/')
    ? path.slice(10)
    : path.startsWith('/control/')
      ? path.slice(1)
      : null;
  if (relative === null) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (relative.endsWith('/') || relative === '') relative += 'index.html';
  const file = resolve(root, decodeURIComponent(relative));
  if (!file.startsWith(root + '/')) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    const bytes = readFileSync(file);
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(4179, '127.0.0.1');
function shutdown() {
  server.closeAllConnections();
  server.close();
  child.kill();
  rmSync(directory, { recursive: true, force: true });
  process.exit();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
