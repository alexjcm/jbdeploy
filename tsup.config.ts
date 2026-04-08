import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/cli.ts',
  },
  format: ['esm'],
  clean: true,
  minify: true,
  shims: false,
  splitting: false,
  platform: 'node',
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: [/(.*)/],
  target: 'node24',
});
