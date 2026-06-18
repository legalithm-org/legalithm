import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveApiUrl, resolveApiKey, DEFAULT_API_URL } from '../config.js';
import { postJson, CliHttpError } from '../http.js';
import { readRecord, writeRecordBundle } from '../record-io.js';
import type { StoredRecord, UseCase } from '../types.js';

const INPUT: UseCase = { role: 'provider', domain: 'employment', use_case: 'x', audience: 'workers' };
const RECORD = {
  schemaVersion: '1.0',
  recordId: 'r1',
  inputHash: 'h',
  asOf: '2026-06-17',
  legalBasis: { engineVersion: 'eng-1', statement: 'As of 2026-06-17 ...' },
  system: { name: 'acme', version: '1.0.0', input: INPUT },
  classification: { risk: 'high' },
  disclaimer: 'Checked against Regulation (EU) 2024/1689 — not legal advice.',
  obligations: [{ title: 'Risk management', description: 'Art 9', how_to_prove: 'doc', priority: 'high' }],
  annex4: { sections: { a: { title: 'System Overview', content: 'body' } } },
} as StoredRecord;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legalithm-io-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('config', () => {
  it('resolves the API url (env override, else default)', () => {
    expect(resolveApiUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_API_URL);
    expect(resolveApiUrl({ LEGALITHM_API_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv)).toBe('http://localhost:3000');
  });

  it('resolves the API key: env wins, then credentials file, else undefined', () => {
    expect(resolveApiKey({ LEGALITHM_API_KEY: 'lgl_env' } as NodeJS.ProcessEnv, dir)).toBe('lgl_env');
    // file fallback
    mkdirSync(join(dir, '.config', 'legalithm'), { recursive: true });
    writeFileSync(join(dir, '.config', 'legalithm', 'credentials.json'), JSON.stringify({ apiKey: 'lgl_file' }));
    expect(resolveApiKey({} as NodeJS.ProcessEnv, dir)).toBe('lgl_file');
  });

  it('returns undefined when no key is anywhere', () => {
    expect(resolveApiKey({} as NodeJS.ProcessEnv, dir)).toBeUndefined();
  });

  it('returns undefined for a malformed credentials file', () => {
    mkdirSync(join(dir, '.config', 'legalithm'), { recursive: true });
    writeFileSync(join(dir, '.config', 'legalithm', 'credentials.json'), 'not json');
    expect(resolveApiKey({} as NodeJS.ProcessEnv, dir)).toBeUndefined();
  });
});

describe('postJson', () => {
  function stubFetch(impl: () => Promise<Response> | Response) {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('returns parsed JSON on 200', async () => {
    stubFetch(() => new Response(JSON.stringify({ risk: 'high' }), { status: 200 }));
    await expect(postJson('http://x/api', {}, 'lgl_k')).resolves.toEqual({ risk: 'high' });
  });

  it('maps 401 → auth, 429 → rate, 500 → api', async () => {
    stubFetch(() => new Response('', { status: 401 }));
    await expect(postJson('http://x', {}, 'k')).rejects.toMatchObject({ kind: 'auth', status: 401 });
    stubFetch(() => new Response('', { status: 429 }));
    await expect(postJson('http://x', {}, 'k')).rejects.toMatchObject({ kind: 'rate', status: 429 });
    stubFetch(() => new Response('', { status: 500 }));
    await expect(postJson('http://x', {}, 'k')).rejects.toMatchObject({ kind: 'api', status: 500 });
  });

  it('maps a transport failure → network', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(postJson('http://x', {}, 'k')).rejects.toBeInstanceOf(CliHttpError);
    await expect(postJson('http://x', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });

  it('sends the bearer key', async () => {
    const fetchMock = vi.fn(() => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await postJson('http://x', { a: 1 }, 'lgl_secret');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://x',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer lgl_secret' }) }),
    );
  });
});

describe('record-io', () => {
  it('round-trips the record and writes both markdown artifacts', () => {
    writeRecordBundle(dir, RECORD);
    expect(readRecord(dir)).toEqual(RECORD);
    expect(existsSync(join(dir, 'compliance', 'annex-iv.md'))).toBe(true);
    const checklist = readFileSync(join(dir, 'compliance', 'checklist.md'), 'utf8');
    expect(checklist).toContain('# AI Act Obligations — acme');
    expect(checklist).toContain('Risk management');
    expect(checklist).toContain('not legal advice');
    const annex = readFileSync(join(dir, 'compliance', 'annex-iv.md'), 'utf8');
    expect(annex).toContain('## System Overview');
  });

  it('returns null when no record exists', () => {
    expect(readRecord(dir)).toBeNull();
  });

  it('renders a no-obligations checklist without crashing', () => {
    writeRecordBundle(dir, { ...RECORD, obligations: [] } as StoredRecord);
    expect(readFileSync(join(dir, 'compliance', 'checklist.md'), 'utf8')).toContain('No high-risk obligations');
  });

  it('falls back to a generic disclaimer and handles bare sections/obligations', () => {
    const bare = {
      ...RECORD,
      disclaimer: undefined,
      obligations: [{ title: 'T', description: 'D' }],
      annex4: { sections: { a: { title: 'Sec', content: 'body' } } },
    } as unknown as StoredRecord;
    writeRecordBundle(dir, bare);
    expect(readFileSync(join(dir, 'compliance', 'checklist.md'), 'utf8')).toContain('Not legal advice.');
    expect(readFileSync(join(dir, 'compliance', 'annex-iv.md'), 'utf8')).toContain('## Sec');
  });
});
