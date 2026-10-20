# Project website and GitHub Pages

The project overview lives at `/camx-pro/`; the full CAD inspector lives at
`/camx-pro/viewer.html`. Both are built together by Vite. Relative asset URLs
support the GitHub project subpath and a local static preview.

## Design contract

The overview introduces the actual P3 mechanism, its printable construction,
firmware and current qualification status. Opening the CAD inspector is the
primary action. Real CAD renders lead; no unrelated stock imagery or product
claims are used. The existing dark viewer remains a focused inspection tool.

- Palette: drawing background `#e7ece8`, paper `#f8faf7`, ink `#20372e`,
  secondary text `#51645a`, control green `#285f47`, rules `#c6d1c8`.
- Type: Avenir Next/Trebuchet/system sans; large plain headings, readable body
  copy, sentence-case navigation and controls. No remote font dependency.
- Layout: left-aligned project introduction beside a large actual-CAD image;
  a lazy interactive preview; illustrated mechanism explanation; firmware,
  qualification status and named download/documentation links.
- Mobile: stacked content, wrapped navigation, usable viewer controls, no
  horizontal scrolling. Keyboard focus stays visible. Loading/error/static
  fallback states remain useful without WebGL.

```text
Project navigation
Introduction + actions | actual CAD rendering
Hardware and print specifications
Interactive preview + full viewer link
Planetary rendering   | mechanical explanation
Firmware              | build / qualification status
Downloads and documentation
```

The palette follows the CAD drawing background and existing viewer rather than
adding a separate marketing theme. The large model is the primary visual;
technical information uses simple lists and tables instead of repeated cards.

## Versioned model assets

The Pages build downloads a versioned CAD asset bundle from this repository's
GitHub release. `apps/site/assets.lock.json` pins the URL, byte count, SHA-256 and
CAD source fingerprint. `tools/website/assets.py` verifies these before staging
an allowlisted set of model, manifest, CAD renders and prototype downloads.
Credentials, compiled firmware and arbitrary export-directory contents are
never included. The website build fails if the CAD source no longer matches.

This keeps generated manufacturing files out of Git while making a clean
checkout reproducible. It also avoids rebuilding the CAD kernel for page-only
edits. A revised mechanical design needs newly verified exports and a new
versioned asset bundle; never replace a release asset under an existing lock.

## Local build

```sh
python3 tools/website/assets.py fetch
npm ci
npm run build
node apps/site/scripts/verify-site.mjs
npm run test:browser
```

Browser tests need Chromium installed with
`npx playwright install chromium`. The static site is `apps/site/dist`.
Use `npm --workspace @camx/site run preview` to inspect it. The project page loads only
small images until someone explicitly opens an interactive model.

## Deployment

`.github/workflows/pages.yml` validates and builds on pull requests, main-branch pushes, temporary
`ci/pages-*` verification branches and manual runs. Only trusted `main` runs can publish, using
the tested artifact, a separate `github-pages` environment job and the Pages
OIDC token. Build jobs have read-only repository access and no deployment secrets.
GitHub Pages must use the GitHub Actions publishing source (`build_type: workflow`).

The website is a public design inspector. It does not connect to or move the
ESP32; the remote at `/control/` is an offline demo. Live motor control uses the localhost
bridge or the Glyphora terminal application; see [controllers](controllers.md).
