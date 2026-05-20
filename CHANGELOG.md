# Changelog

All notable changes to this project will be documented in this file.

## [1.4.0] - 2026-05-20

### Added
- Added WAR-only multi-selection when 2 or more WAR artifacts are detected, allowing selection and confirmation in a single deploy execution.
- Added an explicit `Repeat last flow` entry point for project-local reuse instead of relying on an implicit confirmation prompt.
- Added quick editing for saved servers directly from the interactive server selection flow.

### Changed
- Improved artifact selection by preselecting the most relevant candidate using the last deployed artifact and recent modification time.
- Improved WAR multi-selection defaults by preselecting all previously selected WAR artifacts when available, with fallback to one recommended artifact.
- Extended repeat-flow memory to support multiple artifact names while remaining backward compatible with existing `artifactName` data.

## [1.3.0] - 2026-04-18

### Changed
- Upgraded TypeScript to 6 and updated TypeScript ESLint compatibility to the TS6-supported range.
- Updated action labels to clearer UX wording (`Build, copy & start`, `Copy & start`, `Start server`).
- Made action labels context-aware when the server is already running (`Build, copy & deploy`, `Copy & deploy`).
- Refined deploy/start feedback messages to reduce visual noise and show the selected server more clearly.

### Fixed
- Fixed reuse mode formatting to avoid confusing values like `normal:5005` and only show debug port when applicable.
- Added contextual visibility for artifacts already present on the selected server, excluding `*.undeployed` entries.

## [1.2.0] - 2026-04-08

### Added
- Added `← Back` option across all menus to allow returning to the server list without restarting the CLI.

### Changed
- Replaced `fast-glob` with native `fs` methods for faster execution and a smaller bundle size.
- Updated minimum Node engine requirement to `>=20.0.0`.

### Fixed
- Fixed false "Failed to start server" error when intentionally stopping a server with `Ctrl+C`.
- Updated prompt messaging to accurately display the total number of matched artifacts found.

---

## [1.0.0] - 2026-03-22

- Initial npm publication and major project refactoring of Core, Server, and UI modules.
