import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runInit } from '../commands/init.js';
import { runCheck } from '../commands/check.js';
import { runLogin } from '../commands/login.js';
import type { StoredRecord, UseCase } from '../types.js';

const INPUT: UseCase = { role: 'provider', domain: 'employment', use_case: 'screen candidates', audience: 'workers' };

function fakeRecord(over: Partial<StoredRecord> = {}): StoredRecord {
  return {
    schemaVersion: '1.0',
    recordId: 'r1',
    inputHash: 'hash-a',
    asOf: '2026-06-17',
    legalBasis: { engineVersion: 'eng-1', statement: 'As of 2026-06-17, per Regulation (EU) 2024/1689 (engine veng-1).' },
    system: { name: 'acme', version: '1.0.0', input: INPUT },
    classification: { risk: 'high' },
    disclaimer: 'Checked against Regulation (EU) 2024/1689 — not legal advice.',
    obligations: [{ title: 'Risk management', description: 'Article 9', how_to_prove: 'Document it', priority: 'high' }],
    annex4: { sections: { systemOverview: { title: 'System Overview', content: 'x', todo: ['do y'] } } },
    ...over,
  } as StoredRecord;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legalithm-cli-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runInit', () => {
  it('writes a valid record bundle and exits 0', async () => {
    const res = await runInit({
      cwd: dir,
      system: { name: 'acme', version: '1.0.0' },
      input: INPUT,
      generate: async () => fakeRecord(),
      log: () => {},
    });
    expect(res.exitCode).toBe(0);
    const recordFile = join(dir, 'compliance', 'legalithm.json');
    expect(existsSync(recordFile)).toBe(true);
    expect(existsSync(join(dir, 'compliance', 'annex-iv.md'))).toBe(true);
    expect(existsSync(join(dir, 'compliance', 'checklist.md'))).toBe(true);
    const written = JSON.parse(readFileSync(recordFile, 'utf8'));
    expect(written.schemaVersion).toBe('1.0');
    expect(written.classification.risk).toBe('high');
    expect(readFileSync(join(dir, 'compliance', 'checklist.md'), 'utf8')).toContain('Risk management');
  });

  it('exits 3 when generation fails (never writes a partial record)', async () => {
    const res = await runInit({
      cwd: dir,
      system: { name: 'acme', version: '1.0.0' },
      input: INPUT,
      generate: async () => {
        throw new Error('network down');
      },
      log: () => {},
    });
    expect(res.exitCode).toBe(3);
    expect(existsSync(join(dir, 'compliance', 'legalithm.json'))).toBe(false);
  });
});

describe('runCheck', () => {
  async function init() {
    await runInit({
      cwd: dir,
      system: { name: 'acme', version: '1.0.0' },
      input: INPUT,
      generate: async () => fakeRecord(),
      log: () => {},
    });
  }

  it('exits 2 when no record exists', async () => {
    const res = await runCheck({ cwd: dir, regenerate: async (s) => s, failOn: 'risk-or-rule', json: false, log: () => {} });
    expect(res.exitCode).toBe(2);
  });

  it('exits 0 when in sync', async () => {
    await init();
    const res = await runCheck({ cwd: dir, regenerate: async () => fakeRecord(), failOn: 'risk-or-rule', json: false, log: () => {} });
    expect(res.exitCode).toBe(0);
    expect(res.report?.status).toBe('in-sync');
  });

  it('exits 1 on risk drift (default fail-on)', async () => {
    await init();
    const res = await runCheck({
      cwd: dir,
      regenerate: async () => fakeRecord({ classification: { risk: 'limited' } }),
      failOn: 'risk-or-rule',
      json: false,
      log: () => {},
    });
    expect(res.exitCode).toBe(1);
    expect(res.report?.drift.some((d) => d.type === 'risk')).toBe(true);
  });

  it('exits 0 on input-only drift under the default policy', async () => {
    await init();
    const res = await runCheck({
      cwd: dir,
      regenerate: async () => fakeRecord({ inputHash: 'hash-b' }),
      failOn: 'risk-or-rule',
      json: false,
      log: () => {},
    });
    expect(res.exitCode).toBe(0);
  });

  it('exits 3 when the API call fails', async () => {
    await init();
    const res = await runCheck({
      cwd: dir,
      regenerate: async () => {
        throw new Error('401');
      },
      failOn: 'risk-or-rule',
      json: false,
      log: () => {},
    });
    expect(res.exitCode).toBe(3);
  });

  it('emits parseable JSON in --json mode', async () => {
    await init();
    let out = '';
    await runCheck({ cwd: dir, regenerate: async () => fakeRecord(), failOn: 'risk-or-rule', json: true, log: (m) => (out += m) });
    expect(JSON.parse(out).status).toBe('in-sync');
  });

  it('prints human-readable drift output in non-json mode', async () => {
    await init();
    let out = '';
    await runCheck({
      cwd: dir,
      regenerate: async () => fakeRecord({ classification: { risk: 'limited' } }),
      failOn: 'risk-or-rule',
      json: false,
      log: (m) => (out += `${m}\n`),
    });
    expect(out).toContain('drift detected');
    expect(out).toContain('risk drift: high → limited');
  });
});

describe('runLogin', () => {
  it('rejects a missing or malformed key (exit 2, no write)', () => {
    expect(runLogin(undefined, () => {}, join(dir, 'creds.json'))).toBe(2);
    expect(runLogin('not-a-key', () => {}, join(dir, 'creds.json'))).toBe(2);
    expect(existsSync(join(dir, 'creds.json'))).toBe(false);
  });

  it('writes a valid key to the given path (exit 0)', () => {
    const path = join(dir, 'nested', 'creds.json');
    expect(runLogin(`lgl_${'a'.repeat(64)}`, () => {}, path)).toBe(0);
    expect(JSON.parse(readFileSync(path, 'utf8')).apiKey).toBe(`lgl_${'a'.repeat(64)}`);
  });
});
