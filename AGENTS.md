# Repository Guidelines

## Project Structure & Module Organization

`camx-pro` is currently an initial workspace with no application source, tests, assets, or package manifest. No framework or module layout has been established. When adding the first implementation, group related code by feature and document the chosen source, test, and asset directories in this guide. Keep generated output separate from maintained source files.

## Build, Test, and Development Commands

No build, test, lint, or development commands are configured yet. Do not assume commands such as `npm test` or `make build` exist. When introducing tooling, add reproducible setup instructions and the exact commands to the project README.

Once Git is initialized, use:

- `git status --short` to review changed and untracked files.
- `git diff` to inspect unstaged changes.
- `git diff --check` to catch whitespace errors in tracked changes.

## Coding Style & Naming Conventions

No language, indentation standard, formatter, or linter has been selected. Follow the conventions of the chosen language and add shared formatter and linter configuration with the first implementation. Use descriptive names, keep modules focused, and avoid unrelated formatting changes.

## Testing Guidelines

No testing framework or coverage threshold is configured. Introduce tests alongside executable behavior, using the selected framework’s standard file naming and discovery rules. Cover expected behavior, meaningful edge cases, and regression scenarios. Document how contributors run the suite locally.

## Commit & Pull Request Guidelines

No Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add initial application configuration`. Keep commits focused.

Pull requests should explain the change, link related issues when applicable, and record validation performed or why it could not run. Include screenshots for visible interface changes.

## Security & Configuration

Never commit credentials, private keys, or local environment secrets. Provide placeholder configuration examples and add appropriate ignore rules when introducing tools or generated files.
