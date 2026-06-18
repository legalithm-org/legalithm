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
