import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { credentialsPath } from '../config.js';

/** Persist an API key to ~/.config/legalithm/credentials.json (0600). Returns an exit code. */
export function runLogin(
  apiKey: string | undefined,
  log: (m: string) => void = console.log,
  path: string = credentialsPath(),
): number {
  if (!apiKey || !apiKey.startsWith('lgl_')) {
    log('Usage: legalithm login --key lgl_...  (create a key at /app/settings/api-keys)');
    return 2;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ apiKey }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  log(`✓ Saved API key to ${path}`);
  return 0;
}
