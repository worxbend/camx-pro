# Project website and GitHub Pages

The project overview lives at `/camx-pro/`; the full CAD inspector lives at
`/camx-pro/viewer.html`. Both are built together by Vite. Relative asset URLs
support the GitHub project subpath and a local static preview.

## Design and interaction

The landing page uses lavender (`#e4ddf4`), dark plum (`#20142b`), apricot
(`#ff8b5c`) and warm paper (`#faf9f6`). Anton display type and Manrope body type
are self-hosted through pinned npm font packages. No third-party font or model
service is contacted at runtime.

Three sections introduce the rig, expose its mechanism and provide build files.
The hero loads the real 103-part P3 GLB automatically (approximately 14 MB).
A second, exploded assembly initializes near the viewport and shares the cached
model download and geometry. Each stage owns independent joints and materials.
The lower build section reuses a rendered image, avoiding a third WebGL context.

- Exterior, X-ray and exploded modes; pointer orbit and keyboard orbit/zoom.
- Pan/tilt sliders and a finite, explicit two-axis animation; this is a visual
  demonstration, not a simulation of the firmware's timing or physical qualification.
- Three printed-part finish previews, transparent PNG export and shareable pose URLs.
- Accessible native accordion and share dialog, visible focus and reduced-motion
  support. Motion stops offscreen or when the tab is hidden. Idle scenes render only
  when their state changes. Vertical touch scrolling stays available over the model.
- Missing assets or unavailable WebGL show a static preview and retry control.
  Downloads and guides remain normal links, including with JavaScript disabled.

Implementation: `src/landing.js` coordinates the page; `src/studio-scene.js` owns
rendering and camera interaction; `src/cad-model.js` loads and assembles CAD;
`src/kinematics.js` is shared with the existing full inspector. HTML and CSS remain
in `index.html` and `src/landing.css`. The full inspector has its own entry point.

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
Use `npm --workspace @camx-pro/site run preview` to inspect the production build, or
`npm run dev:site -- --port 5173` for Vite development. The hero loads the pinned GLB
on entry; its loading state discloses the download size. Browser tests cover real
rendering, view changes, pose links, PNG export, keyboard input, reduced motion,
320–1440 px layouts, and missing-model/WebGL fallbacks.

## Deployment

`.github/workflows/pages.yml` validates and builds on pull requests, main-branch pushes, temporary
`ci/pages-*` verification branches and manual runs. Only trusted `main` runs can publish, using
the tested artifact, a separate `github-pages` environment job and the Pages
OIDC token. Build jobs have read-only repository access and no deployment secrets.
GitHub Pages must use the GitHub Actions publishing source (`build_type: workflow`).

The website is a public design inspector. It does not connect to or move the
ESP32; the remote at `/control/` is an offline demo. Live motor control uses the localhost
bridge or the Glyphora terminal application; see [controllers](controllers.md).
