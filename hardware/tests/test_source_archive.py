from tools.source_archive import maintained_sources


def test_sources_keep_project_layout_but_exclude_credentials_builds_and_symlinks(tmp_path):
    public = ['README.md', 'Makefile', 'hardware/cad/config.py', 'firmware/include/credentials.example.h',
              'apps/tui/.mill-version', 'apps/remote/src/main.jsx', 'tools/contracts/firmware.py',
              'packages/control/src/session.mjs', 'tests/integration/server.mjs']
    private = ['firmware/include/credentials.h', 'firmware/include/web_ui.hpp',
               'hardware/exports/manifest.json', 'apps/site/public/downloads/manifest.json',
               'apps/tui/out/secret.json', 'apps/remote/node_modules/example/index.js',
               'hardware/.venv/secret.py', 'apps/remote/.env.production']
    for name in public + private:
        file = tmp_path / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('fixture')
    (tmp_path / 'hardware/cad/linked.py').symlink_to(tmp_path / 'firmware/include/credentials.h')
    assert {str(f.relative_to(tmp_path)) for f in maintained_sources(tmp_path)} == set(public)
