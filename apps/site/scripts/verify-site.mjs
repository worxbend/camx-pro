import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
let checked = 0;
for (const page of ['index.html', 'viewer.html', 'control/index.html']) {
  const file = resolve(root, page),
    html = readFileSync(file, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|#|data:)/.test(url)) continue;
    assert(!url.startsWith('/'), `${page}: root-relative URL breaks GitHub project pages: ${url}`);
    let local = resolve(dirname(file), url.split(/[?#]/)[0]);
    assert(local === root || local.startsWith(root + '/'), `URL escaped site: ${url}`);
    if (existsSync(local) && statSync(local).isDirectory()) local = resolve(local, 'index.html');
    assert(existsSync(local), `${page}: missing local target ${url}`);
    checked++;
  }
}
const lock = JSON.parse(readFileSync(new URL('../assets.lock.json', import.meta.url)));
for (const file of lock.files)
  assert(existsSync(resolve(root, 'downloads', file)), `Missing pinned download ${file}`);
assert.equal(
  JSON.parse(readFileSync(resolve(root, 'downloads/manifest.json'))).cad_source_sha256,
  lock.cad_source_sha256,
);
assert(existsSync(resolve(root, '.nojekyll')));
console.log(
  `Verified ${checked} local HTML links/assets and ${lock.files.length} CAD downloads under the project subpath.`,
);
