/**
 * A test run must never borrow the credentials of whoever is running it.
 *
 * `project-scan.test.ts` asserted that `discover --push` fails without a key. It
 * deleted LEGALITHM_API_KEY and stopped there, so on a machine where somebody
 * had run `legalithm login` the file fallback returned a REAL key: the command
 * authenticated, pushed to production, and the test failed only because the
 * push SUCCEEDED. Seven junk records were created in a real account before
 * anyone noticed.
 *
 * The same shape as the security-log pollution found the same afternoon, and
 * worse, because it wrote to somebody's account rather than their disk.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { resolveApiKey, credentialsPath } from '../config.js';

function homeWithCredentials(key: string): string {
  const home = mkdtempSync(join(tmpdir(), 'creds-'));
  const p = credentialsPath(home);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ apiKey: key }), { mode: 0o600 });
  return home;
}

describe('credentials under test', () => {
  it('ignores a stored credentials file entirely', () => {
    const home = homeWithCredentials('lgl_stored_and_real');
    // process.env.VITEST is set by the runner; this is the production default.
    expect(resolveApiKey(process.env, home)).toBeUndefined();
  });

  // The escape hatch, so a test that genuinely needs a key stays possible and
  // has to say so out loud.
  it('honours an explicit LEGALITHM_API_KEY, which a test must opt into', () => {
    const home = homeWithCredentials('lgl_stored_and_real');
    expect(resolveApiKey({ ...process.env, LEGALITHM_API_KEY: 'lgl_explicit' }, home)).toBe('lgl_explicit');
  });

  // Outside a test run the file fallback is the whole point of `login`, so the
  // guard must not have broken it.
  it('still reads the file when not under test', () => {
    const home = homeWithCredentials('lgl_stored_and_real');
    const env = { ...process.env };
    delete env.VITEST;
    delete env.LEGALITHM_API_KEY;
    expect(resolveApiKey(env, home)).toBe('lgl_stored_and_real');
  });
});
