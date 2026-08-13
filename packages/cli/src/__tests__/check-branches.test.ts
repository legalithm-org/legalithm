import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
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
  system: {
    name: 'app',
    version: '0.0.0',
    input: { role: 'deployer', domain: 'other', use_case: 'x', audience: 'general' },
  },
  classification: { risk: 'limited' },
  disclaimer: 'Checked against Regulation (EU) 2024/1689 — not legal advice.',
  obligations: [],
  annex4: { sections: { a: { title: 'System Overview', content: 'b' } } },
};

/**
 * `check` is the CI command: it is the one that decides whether a build passes.
 * The round-trip case was covered; its branches were not — the SARIF flag in its
 * three forms, a missing record, and an unreachable API.
 *
 * The direction that matters is exiting 0 when it should not. A check that
 * passes because it could not reach the API would mark a drifted record as
 * healthy on every subsequent build.
 */
describe('legalithm check — branches', () => {
  let dir: string;
  let origKey: string | undefined;

  const seedRecord = async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RECORD_JSON), { status: 200 })));
    await main(['init', '--yes']);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legalithm-check-'));
    origKey = process.env.LEGALITHM_API_KEY;
    process.env.LEGALITHM_API_KEY = KEY;
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (origKey === undefined) delete process.env.LEGALITHM_API_KEY;
    else process.env.LEGALITHM_API_KEY = origKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * SARIF is written relative to the real working directory, which is correct
   * for a CLI: `--sarif reports/x.sarif` should land where the user ran it.
   * The process.cwd() stub used elsewhere here does not redirect relative
   * writes, so these pass an absolute path instead of fighting that.
   */
  it('writes SARIF to the path given', async () => {
    await seedRecord();
    const out = join(dir, 'ai-act.sarif');
    await main(['check', '--sarif', out]);
    expect(existsSync(out)).toBe(true);
  });

  it('emits SARIF 2.1.0 that a code-scanning upload would accept', async () => {
    await seedRecord();
    const out = join(dir, 'ai-act.sarif');
    await main(['check', '--sarif', out]);
    const sarif = JSON.parse(readFileSync(out, 'utf8'));
    expect(sarif.version).toBe('2.1.0');
    expect(Array.isArray(sarif.runs)).toBe(true);
  });

  it('writes no SARIF file when the flag is absent', async () => {
    await seedRecord();
    await main(['check']);
    expect(existsSync(join(dir, 'ai-act.sarif'))).toBe(false);
  });

  it('fails rather than passing when there is no committed record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RECORD_JSON), { status: 200 })));
    const code = await main(['check']);
    expect(code, 'a missing record must not be treated as in sync').not.toBe(0);
  });

  it('does not silently pass when the record on disk is unreadable', async () => {
    mkdirSync(join(dir, 'compliance'), { recursive: true });
    writeFileSync(join(dir, 'compliance', 'legalithm.json'), '{ not json');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RECORD_JSON), { status: 200 })));
    // main() rejects rather than returning a code here; the bin wrapper catches
    // it and exits 1, so a build still fails. What must never happen is a 0.
    await expect(main(['check'])).rejects.toBeDefined();
  });

  it('does not report success when the API is unreachable', async () => {
    await seedRecord();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const code = await main(['check']);
    expect(code, 'an unreachable API must not read as a healthy record').not.toBe(0);
  });

  it('honours --no-prompt on init so CI never blocks on the save-or-share question', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RECORD_JSON), { status: 200 })));
    const code = await main(['init', '--yes', '--no-prompt']);
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'compliance', 'legalithm.json'))).toBe(true);
  });
});
