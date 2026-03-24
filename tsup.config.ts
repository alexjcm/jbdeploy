import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/cli.ts',
  },
  format: ['esm'],
  clean: true,
  minify: true,
  shims: true,
  splitting: false,
  platform: 'node',
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Do not bundle dependencies; rely on npm install
  noExternal: [],
  // Node.js target
  target: 'node24',
});
