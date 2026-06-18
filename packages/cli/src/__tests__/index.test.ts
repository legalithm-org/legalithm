import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from '../index.js';

const KEY = `lgl_${'a'.repeat(64)}`;

const RECORD_JSON = {
  schemaVersion: '1.0',
  recordId: 'r1',
  inputHash: 'h',
  asOf: '2026-06-17',
  legalBasis: { engineVersion: 'eng-1', statement: 'As of 2026-06-17 ...' },
  system: { name: 'app', version: '0.0.0', input: { role: 'deployer', domain: 'other', use_case: 'x', audience: 'general' } },
  classification: { risk: 'limited' },
  disclaimer: 'Checked against Regulation (EU) 2024/1689 — not legal advice.',
  obligations: [],
  annex4: { sections: { a: { title: 'System Overview', content: 'b' } } },
};
let origKey: string | undefined;

beforeEach(() => {
  origKey = process.env.LEGALITHM_API_KEY;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (origKey === undefined) delete process.env.LEGALITHM_API_KEY;
  else process.env.LEGALITHM_API_KEY = origKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Only no-file-write paths are exercised here (init/check file ops are covered by command-core tests).
describe('main dispatcher', () => {
  it('help → 0', async () => {
    expect(await main(['help'])).toBe(0);
    expect(await main(['anything', '--help'])).toBe(0);
  });

  it('login without a key → 2', async () => {
    expect(await main(['login'])).toBe(2);
  });

  it('a key-requiring command with no key → 2', async () => {
    delete process.env.LEGALITHM_API_KEY;
    expect(await main(['check'])).toBe(2);
  });

  it('classify with a key + ok response → 0', async () => {
    process.env.LEGALITHM_API_KEY = KEY;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ risk: 'high' }), { status: 200 })));
    expect(await main(['classify'])).toBe(0);
  });

  it('classify with a key + API failure → 3', async () => {
    process.env.LEGALITHM_API_KEY = KEY;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect(await main(['classify'])).toBe(3);
  });

  it('unknown command with a key → 1', async () => {
    process.env.LEGALITHM_API_KEY = KEY;
    expect(await main(['bogus'])).toBe(1);
  });

  it('init then check round-trips in a temp cwd (exit 0, record written)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'legalithm-main-'));
    try {
      process.env.LEGALITHM_API_KEY = KEY;
      vi.spyOn(process, 'cwd').mockReturnValue(dir);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RECORD_JSON), { status: 200 })));

      expect(await main(['init', '--yes'])).toBe(0);
      expect(existsSync(join(dir, 'compliance', 'legalithm.json'))).toBe(true);

      // Same stub → fresh record matches stored → in sync → exit 0.
      expect(await main(['check'])).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
