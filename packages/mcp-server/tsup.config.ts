import { defineConfig } from 'tsup';
import { resolve } from 'path';

// Bundle the pure engine (classifyUseCase + risk_map.json) so classify/explain
// work offline in the editor. `@` resolves to the repo root (build runs from the package dir).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  esbuildOptions(options) {
    options.alias = { '@': resolve(process.cwd(), '../..') };
  },
});
