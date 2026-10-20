/** Serve the Solid client locally and optionally proxy to one explicitly configured LAN ESP32. */
import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function privateAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '');
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    );
  }
  if (net.isIP(ip) === 6) {
    const low = ip.toLowerCase();
    return low === '::1' || /^f[cd][0-9a-f]{2}:/.test(low) || /^fe[89ab][0-9a-f]:/.test(low);
  }
  return false;
}
const routes = new Set(['/api/state', '/api/command']);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
export async function createControlServer({ deviceUrl = '', directory, port = 4175 } = {}) {
  let target = null;
  if (deviceUrl) {
    target = new URL(deviceUrl);
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      target.pathname !== '/'
    )
      throw Error(
        'CAMX_DEVICE_URL must be an HTTP(S) device origin without credentials, query, or path',
      );
  }
  const base = directory ?? fileURLToPath(new URL('../../../apps/remote/dist/', import.meta.url));
  const server = http.createServer(async (req, res) => {
    const send = (code, message) => {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: message }));
      }
    };
    try {
      const boundPort = server.address()?.port ?? port;
      const allowedHosts = new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
      if (!allowedHosts.has(req.headers.host)) {
        send(403, 'Use the local server address');
        return;
      }
      if (
        req.headers.origin &&
        ![`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`].includes(
          req.headers.origin,
        )
      ) {
        send(403, 'Origin rejected');
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (routes.has(url.pathname)) {
        if (url.search) {
          send(400, 'API query parameters are unsupported');
          return;
        }
        if (!target) {
          send(
            503,
            'No device configured. Start with CAMX_DEVICE_URL=http://DEVICE_IP or use demo mode.',
          );
          return;
        }
        const method = req.method;
        if (!/^Bearer [\x21-\x7e]{16,128}$/.test(req.headers.authorization ?? '')) {
          send(401, 'Valid Bearer token required');
          return;
        }
        if (
          (url.pathname === '/api/state' && method !== 'GET') ||
          (url.pathname !== '/api/state' && method !== 'POST')
        ) {
          send(405, 'Method rejected');
          return;
        }
        if (method === 'POST' && req.headers['x-camx-request'] !== '1') {
          send(400, 'X-CAMX-Request: 1 required');
          return;
        }
        const length = Number(req.headers['content-length'] ?? 0);
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > 768 ||
          req.headers['transfer-encoding']
        ) {
          send(413, 'Request body limit is 768 bytes');
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 768) {
            send(413, 'Request body limit is 768 bytes');
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const hostname = target.hostname.replace(/^\[|\]$/g, '');
        let dnsTimer;
        const addresses = await Promise.race([
          dns.lookup(hostname, { all: true }),
          new Promise((_, reject) => {
            dnsTimer = setTimeout(() => reject(new Error('DNS deadline')), 2000);
          }),
        ]).finally(() => clearTimeout(dnsTimer));
        if (res.destroyed) return;
        if (!addresses.length || addresses.some((a) => !privateAddress(a.address))) {
          send(403, 'Device must resolve exclusively to local/private addresses');
          return;
        }
        const selected = addresses.find((a) => a.family === 4) ?? addresses[0];
        const headers = {};
        for (const name of ['content-type', 'authorization', 'x-camx-request'])
          if (req.headers[name]) headers[name] = req.headers[name];
        if (body.length || method === 'POST') headers['content-length'] = String(body.length);
        const outgoing = (target.protocol === 'https:' ? https : http).request(
          new URL(url.pathname, target),
          {
            method,
            headers,
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [selected]);
              else callback(null, selected.address, selected.family);
            },
          },
          (upstream) => {
            res.writeHead(upstream.statusCode ?? 502, {
              'Content-Type': upstream.headers['content-type'] ?? 'application/json',
              'Cache-Control': 'no-store',
            });
            upstream.on('error', () => res.destroy());
            upstream.pipe(res);
          },
        );
        const timer = setTimeout(() => outgoing.destroy(new Error('Device timeout')), 2500);
        outgoing.on('error', () => {
          if (res.headersSent) res.destroy();
          else send(502, 'Device unavailable or timed out');
        });
        outgoing.on('close', () => clearTimeout(timer));
        res.on('close', () => {
          if (!res.writableEnded) outgoing.destroy();
        });
        outgoing.end(body);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(405, 'Method rejected');
        return;
      }
      if (url.pathname === '/' || url.pathname === '/control') {
        res.writeHead(302, { Location: '/control/' });
        res.end();
        return;
      }
      if (!url.pathname.startsWith('/control/')) {
        send(404, 'Not found');
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice('/control/'.length)) || 'index.html';
      if (
        relative.includes('\0') ||
        relative.includes('\\') ||
        relative.split('/').some((segment) => segment === '..' || segment === '.') ||
        path.isAbsolute(relative)
      ) {
        send(400, 'Invalid asset path');
        return;
      }
      const file = path.resolve(base, relative);
      if (!file.startsWith(path.resolve(base) + path.sep)) {
        send(400, 'Invalid asset path');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        send(404, 'Not found');
        return;
      }
      const content = await readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': content.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error.code === 'ENOENT') send(404, 'Build the client first: npm run build:remote');
      else send(400, 'Invalid request or unavailable device');
    }
  });
  server.setTimeout(5000, (socket) => socket.destroy());
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4175);
  const server = await createControlServer({ deviceUrl: process.env.CAMX_DEVICE_URL ?? '', port });
  server.listen(port, '127.0.0.1', () => {
    console.log(`CAMX Pro Remote: http://127.0.0.1:${port}/control/`);
    console.log(
      process.env.CAMX_DEVICE_URL
        ? 'LAN device proxy configured (tokens are never logged).'
        : 'No LAN device configured. Demo is available; add CAMX_DEVICE_URL to control hardware.',
    );
  });
}
