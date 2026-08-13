import { defineConfig } from 'tsup';
import { resolve } from 'path';

/**
 * The MCPB bundle build. SEPARATE FROM tsup.config.ts ON PURPOSE.
 *
 * npm and MCPB want opposite things from the same entry point.
 *
 * npm installs `dependencies` for the consumer, so the published package should
 * keep `@modelcontextprotocol/sdk` and `zod` external: a consumer then picks up
 * their patch releases without waiting for Legalithm to republish. Inlining
 * them into the npm build would quietly convert every future SDK security fix
 * into a release we have to ship.
 *
 * An MCPB bundle is a zip a user downloads and runs. Nothing installs anything.
 * The default build's output still carried bare `@modelcontextprotocol/sdk` and
 * `zod` imports, so packing it would have produced a server that fails to start
 * on every machine that is not the one it was built on — a broken public
 * listing, which is worse than no listing.
 *
 * The alternative, shipping node_modules inside the zip, is what the MCPB docs
 * suggest ("ensure all your production dependencies are in this directory").
 * Here that means 11 MB of prod deps, and 67 MB if anyone packs the directory
 * without pruning tsup and typescript first. One inlined file is smaller than
 * both and cannot be packed wrong.
 *
 * Output goes to `mcpb/` — a staging directory holding exactly the manifest and
 * this file, so `mcpb pack` cannot sweep in src/, node_modules/ or dist/.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'mcpb',
  format: ['esm'],
  target: 'node18',
  clean: true,
  // Inline everything. This is the one line that differs from the npm build,
  // and the reason this file exists.
  noExternal: [/.*/],
  banner: { js: '#!/usr/bin/env node' },
  esbuildOptions(options) {
    options.alias = { '@': resolve(process.cwd(), '../..') };
  },
});
