"""Select maintained monorepo sources for a reproducible manufacturing package."""
import os
from pathlib import Path

SOURCE_DIRS = ('hardware', 'firmware', 'apps', 'packages', 'contracts', 'docs', 'tests', 'tools', '.github')
ROOT_FILES = ('README.md', 'Makefile', 'package.json', 'package-lock.json',
              'playwright.config.js', '.prettierrc.json', '.gitignore')
SKIP_DIRS = {'node_modules', 'dist', 'out', 'exports', 'release', '.venv', 'venv', '.pio',
             'build', 'data', '__pycache__', '.pytest_cache', '.bsp', '.scala-build',
             '.metals', '.idea', '.vscode', 'downloads', 'test-results', 'playwright-report'}
SOURCE_SUFFIXES = {'.py', '.json', '.md', '.csv', '.svg', '.png', '.jpg', '.mjs', '.jsx',
                   '.js', '.html', '.css', '.cpp', '.hpp', '.h', '.ini', '.toml', '.txt',
                   '.in', '.yml', '.yaml', '.mill', '.scala'}
SPECIAL_FILES = {'mill', '.mill-version', '.mill-jvm-version', '.clang-format'}


def maintained_sources(repo: Path):
    for name in ROOT_FILES:
        path = repo / name
        if path.is_file() and not path.is_symlink():
            yield path
    for directory in SOURCE_DIRS:
        for base, dirs, files in os.walk(repo / directory):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not (Path(base) / d).is_symlink())
            for name in sorted(files):
                path = Path(base) / name
                if path.is_symlink() or name in {'credentials.h', 'secrets.h', 'web_ui.hpp'} or name.startswith('.env'):
                    continue
                if path.suffix in SOURCE_SUFFIXES or name in SPECIAL_FILES:
                    yield path
