# Repository Guidelines

## Project Structure & Module Organization

This repository contains a single TypeScript CLI package for deploying EAR/WAR artifacts to JBoss/WildFly.

- `src/cli.ts`: main interactive flow and entrypoint used for the bundled CLI.
- `src/ui/`: terminal prompts and logging helpers.
- `src/core/`: build, artifact discovery, and deployment logic.
- `src/server/`: server lifecycle helpers such as start, cleanup, running-state detection, and deployed-artifact inspection.
- `src/config/`: local config persistence under `~/.jbdeploy/config.json`.
- `dist/`: generated bundle output from `tsup` for npm distribution.

## Build, Test, and Development Commands

- `npm run build`: bundle the CLI into `dist/index.js` with `tsup`.
- `npm run dev`: run the CLI in watch mode with `tsx`.
- `npm run lint`: run ESLint over `src/`.
- `npm run lint:fix`: apply safe lint fixes.
- `npm pack --dry-run --cache /tmp/jbdeploy-npm-cache`: verify publish contents before npm release.

There is currently no dedicated `npm test` script. At minimum, contributors should run `npm run build` and `npm run lint` before submitting changes.

## Coding Style & Naming Conventions

Use TypeScript with ESM imports and 2-space indentation. Prefer focused modules and small helpers over large mixed-purpose files. Follow existing naming:

- files: kebab-case, for example `detect-running.ts`
- exported types/interfaces: PascalCase
- constants: UPPER_SNAKE_CASE or grouped constant objects
- functions/variables: camelCase

Linting is configured in `eslint.config.js`. Keep terminal UX concise and avoid noisy output.

## Testing Guidelines

This project relies primarily on build/lint validation and manual CLI checks. When changing server detection, deploy flow, or prompt UX, test the affected path manually on the target platform when possible. Document manual verification steps in the PR for behavior-sensitive changes.

Update `CHANGELOG.md` for user-facing changes and keep `package.json` version, tarball contents, and npm release notes aligned before publishing.
