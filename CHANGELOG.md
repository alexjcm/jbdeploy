# Changelog

All notable changes to this project will be documented in this file.

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
