// Offline engine provenance bundled with the CLI (mirrors lib/ai_act/record/generator.ts).

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shortHash } from './record-hash.js';

let cached: string | undefined;

/** Hash of the bundled risk_map.json — matches server-side ENGINE_VERSION. */
export function bundledEngineVersion(): string {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '../data/risk_map.json'), 'utf8');
  cached = shortHash(JSON.parse(raw) as Record<string, unknown>);
  return cached;
}
