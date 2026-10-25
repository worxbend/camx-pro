# Project website and GitHub Pages

Project overview: `/camx-pro/`. Full CAD inspector: `/camx-pro/viewer.html`.
Vite builds both. Relative asset URLs work under the GitHub project subpath and
in a local static preview.

## Design and interaction

Palette: lavender (`#e4ddf4`), dark plum (`#20142b`), apricot (`#ff8b5c`), warm
paper (`#faf9f6`). Anton display and Manrope body type are self-hosted from
pinned npm font packages. No third-party font or model service is contacted at runtime.

Three sections: the rig, its mechanism, build files. The hero loads the real
103-part P3 GLB automatically (about 14 MB). A second, exploded assembly starts
near the viewport and shares the cached model and geometry. Each stage owns its
joints and materials. The build section reuses a rendered image instead of a
third WebGL context.

- Exterior, X-ray and exploded modes; pointer orbit and keyboard orbit/zoom.
- Pan/tilt sliders and a finite two-axis animation. This is a visual demo, not a
  simulation of firmware timing or physical qualification.
- Three printed-part finish previews, transparent PNG export, shareable pose URLs.
- Accessible native accordion and share dialog, visible focus, reduced-motion
  support. Motion stops offscreen or in a hidden tab. Idle scenes render only on
  state change. Vertical touch scrolling stays available over the model.
- Missing assets or no WebGL: static preview plus retry control. Downloads and
  guides stay normal links, also without JavaScript.

Code: `src/landing.js` coordinates the page; `src/studio-scene.js` owns rendering
and camera interaction; `src/cad-model.js` loads and assembles CAD;
`src/kinematics.js` is shared with the full inspector. HTML and CSS live in
`index.html` and `src/landing.css`. The full inspector has its own entry point.

## Versioned model assets

The Pages build downloads a CAD asset bundle from a GitHub release of this
repository. `apps/site/assets.lock.json` pins URL, byte count, SHA-256 and CAD
source fingerprint. `tools/website/assets.py fetch` checks all of them before
staging an allowlisted set: model, manifest, CAD renders, prototype downloads.
Credentials, compiled firmware and arbitrary export files are never included.
The website build fails if the CAD source no longer matches the lock.

Current bundle: `camx-pro-p3.1-web-assets.zip` in release
[`p3.1`](https://github.com/worxbend/camx-pro/releases/tag/p3.1).

Generated manufacturing files stay out of Git; a clean checkout is still
reproducible. Page-only edits need no CAD kernel.

New bundle after a geometry change:

1. Rebuild and verify exports in `hardware/` (see [hardware README](../hardware/README.md)).
2. `python3 tools/website/assets.py pack --tag <tag>` writes
   `release/camx-pro-<tag>-web-assets.zip` and updates `apps/site/assets.lock.json`.
3. Upload the zip to release `<tag>`, then commit the lock.

Never replace a release asset under an existing lock. A new bundle gets a new tag.

## Releases

`python3 tools/release.py <tag>` collects verified exports into `release/<tag>/`. It refuses
stale exports and failed package or slicing reports. Publish with
`gh release create <tag> --prerelease release/<tag>/*`.

| Asset | Content |
| --- | --- |
| `camx-pro-<tag>-print-plates.zip` | 17 A1 mini 3MF print plates |
| `camx-pro-<tag>-parts-3mf.zip` | 47 printable parts, one 3MF each |
| `camx-pro-<tag>-printed-substitutes.zip` | Printed replacements for bearings, shafts and belt drive |
| `camx-pro-<tag>-prototype.zip` | Full manufacturing package: STEP, STL, 3MF, drawings, reports, checksums |
| `camx-pro-<tag>-engineering.pdf` | Engineering summary, drawings and BOM |
| `camx-pro-<tag>-web-assets.zip` | Pinned website CAD bundle (see above) |
| `SHA256SUMS` | Checksums for every asset above |

Releases are engineering prototypes, marked pre-release, until physical
qualification passes.

## Local build

```sh
python3 tools/website/assets.py fetch
npm ci
npm run build
node apps/site/scripts/verify-site.mjs
npm run test:browser
```

Browser tests need Chromium: `npx playwright install chromium`. Static output:
`apps/site/dist`. Preview the production build with
`npm --workspace @camx-pro/site run preview`; develop with
`npm run dev:site -- --port 5173`. The hero loads the pinned GLB on entry; its
loading state shows the download size.

Browser tests cover real rendering, view changes, pose links, PNG export,
keyboard input, reduced motion, 320–1440 px layouts, and missing-model/WebGL fallbacks.

## Deployment

`.github/workflows/pages.yml` validates and builds on pull requests, `main`
pushes, temporary `ci/pages-*` verification branches and manual runs.

- Only trusted `main` runs publish: the tested artifact, a separate
  `github-pages` environment job and the Pages OIDC token.
- Build jobs have read-only repository access and no deployment secrets.
- Pages must use the GitHub Actions publishing source (`build_type: workflow`).

The website is a public design inspector. It never connects to or moves the
ESP32. The remote at `/control/` is an offline demo. Live motor control uses the
localhost bridge or the Glyphora terminal app; see [controllers](controllers.md).
