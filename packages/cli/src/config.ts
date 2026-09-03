// Resolve the API base URL and API key. Key resolution order:
//   1. LEGALITHM_API_KEY env  2. ~/.config/legalithm/credentials.json  3. undefined
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const DEFAULT_API_URL = 'https://www.legalithm.com';

export function resolveApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.LEGALITHM_API_URL || DEFAULT_API_URL;
}

export function credentialsPath(home: string = homedir()): string {
  return join(home, '.config', 'legalithm', 'credentials.json');
}

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string | undefined {
  if (env.LEGALITHM_API_KEY) return env.LEGALITHM_API_KEY;

  /*
   * A test run must never pick up the developer's real credentials.
   *
   * `project-scan.test.ts` asserted that `discover --push` fails without a key.
   * It deleted LEGALITHM_API_KEY from the environment and stopped there, so on
   * a machine where somebody had run `legalithm login` the fallback below
   * returned a REAL key, the command authenticated, and the test pushed to
   * production. Seven junk AI systems were created in the author's own account
   * before anyone noticed, and the test failed only because the push succeeded.
   *
   * A test that needs a key sets LEGALITHM_API_KEY, which still works and is
   * explicit. What cannot happen any more is a test silently borrowing the
   * credentials of whoever is running it.
   */
  if (env.VITEST) return undefined;

  const path = credentialsPath(home);
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      return typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
