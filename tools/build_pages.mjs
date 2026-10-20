/** Compose the tested apps into one static project site; the remote remains a demo on HTTPS. */
import { cp, rm, writeFile } from 'node:fs/promises';
const site = new URL('../apps/site/dist/', import.meta.url);
await rm(new URL('control', site), { recursive: true, force: true });
await cp(new URL('../apps/remote/dist/', import.meta.url), new URL('control/', site), {
  recursive: true,
});
await writeFile(new URL('.nojekyll', site), '');
console.log('Pages artifact: apps/site/dist (overview, CAD viewer, remote demo)');
