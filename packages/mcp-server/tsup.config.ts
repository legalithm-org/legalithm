import { defineConfig } from 'tsup';

// Bundle the pure engine (classifyUseCase + risk_map.json) so classify/explain
// work offline in the editor. The engine is vendored under src/lib/ai_act/, so
// everything resolves via relative imports — no path alias needed.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});
