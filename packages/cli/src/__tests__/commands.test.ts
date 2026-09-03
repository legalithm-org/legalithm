import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runInit } from '../commands/init.js';
import { runCheck } from '../commands/check.js';
import { runLogin } from '../commands/login.js';
import { computeRecordHash } from '../record-hash.js';
import type { StoredRecord, UseCase } from '../types.js';

const INPUT: UseCase = { role: 'provider', domain: 'employment', use_case: 'screen candidates', audience: 'workers' };

function fakeRecord(over: Partial<StoredRecord> = {}): StoredRecord {
  const base: StoredRecord = {
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
  };
  return { ...base, recordHash: over.recordHash ?? computeRecordHash(base) };
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

  it('exits 1 when risk tier was hand-edited without updating recordHash', async () => {
    await init();
    const tampered = fakeRecord({
      classification: { risk: 'minimal' },
      recordHash: fakeRecord().recordHash,
    });
    const { writeRecordBundle } = await import('../record-io.js');
    writeRecordBundle(dir, tampered);
    const res = await runCheck({
      cwd: dir,
      regenerate: async () => fakeRecord(),
      failOn: 'risk-or-rule',
      json: false,
      log: () => {},
    });
    expect(res.exitCode).toBe(1);
    expect(res.report?.drift.some((d) => d.type === 'integrity')).toBe(true);
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

  it('writes SARIF output when --sarif is set', async () => {
    await init();
    const sarifPath = join(dir, 'out.sarif');
    const res = await runCheck({
      cwd: dir,
      regenerate: async () => fakeRecord({ classification: { risk: 'limited' } }),
      failOn: 'risk-or-rule',
      json: false,
      sarif: sarifPath,
      toolVersion: '0.5.0',
      log: () => {},
    });
    expect(res.exitCode).toBe(1);
    expect(existsSync(sarifPath)).toBe(true);
    const sarif = JSON.parse(readFileSync(sarifPath, 'utf8'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0].ruleId).toBe('legalithm/risk-drift');
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
  const KEY = `lgl_${'a'.repeat(64)}`;
  const creds = () => join(dir, 'creds.json');

  /** A terminal that never gets asked anything, unless a test supplies a prompt. */
  const tty = (over: Partial<Parameters<typeof runLogin>[3]> = {}) => ({
    isTty: () => true,
    promptSecret: async () => {
      throw new Error('unexpected prompt');
    },
    warn: () => {},
    ...over,
  });

  it('rejects a missing or malformed key (exit 2, no write)', async () => {
    expect(await runLogin({}, () => {}, creds(), tty({ promptSecret: async () => '' }))).toBe(2);
    expect(await runLogin('not-a-key', () => {}, creds(), tty())).toBe(2);
    expect(existsSync(creds())).toBe(false);
  });

  it('writes a valid key to the given path (exit 0)', async () => {
    const path = join(dir, 'nested', 'creds.json');
    expect(await runLogin(KEY, () => {}, path, tty())).toBe(0);
    expect(JSON.parse(readFileSync(path, 'utf8')).apiKey).toBe(KEY);
  });

  // R3, Article 13(2) risk assessment. --key still works, because removing it
  // would break CI jobs already calling it, but it must never do so silently:
  // the operator has to be told the key is now in their history and was in the
  // process table. Delete the warning and this test goes red.
  it('warns that --key exposed the key in shell history and the process table', async () => {
    const warned: string[] = [];
    expect(await runLogin({ key: KEY }, () => {}, creds(), tty({ warn: (m) => warned.push(m) }))).toBe(0);
    const text = warned.join('\n');
    expect(text).toMatch(/shell history/i);
    expect(text).toMatch(/process table/i);
    // Told, not blocked: the key is still saved.
    expect(JSON.parse(readFileSync(creds(), 'utf8')).apiKey).toBe(KEY);
  });

  it('does not warn about argv when the key never went through argv', async () => {
    for (const source of ['prompt', 'stdin'] as const) {
      const warned: string[] = [];
      const code = await runLogin(source === 'stdin' ? { stdin: true } : {}, () => {}, creds(), {
        isTty: () => true,
        warn: (m) => warned.push(m),
        promptSecret: async () => KEY,
        readStdin: () => `${KEY}\n`,
      });
      expect(code).toBe(0);
      expect(warned.join('\n')).not.toMatch(/process table/i);
    }
  });

  it('prompts when stdin is a terminal and no source flag is given', async () => {
    let asked = '';
    const code = await runLogin({}, () => {}, creds(), {
      isTty: () => true,
      warn: () => {},
      promptSecret: async (p) => {
        asked = p;
        return `${KEY}\n`;
      },
    });
    expect(code).toBe(0);
    expect(asked).toMatch(/hidden/i);
    expect(JSON.parse(readFileSync(creds(), 'utf8')).apiKey).toBe(KEY);
  });

  it('treats a pipe as --stdin, so `echo $KEY | legalithm login` works', async () => {
    const code = await runLogin({}, () => {}, creds(), {
      isTty: () => false,
      warn: () => {},
      readStdin: () => `${KEY}\n`,
    });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(creds(), 'utf8')).apiKey).toBe(KEY);
  });

  it('reads --key-file, trimming the trailing newline', async () => {
    const keyPath = join(dir, 'key.txt');
    writeFileSync(keyPath, `${KEY}\n`, { mode: 0o600 });
    expect(await runLogin({ keyFile: keyPath }, () => {}, creds(), tty())).toBe(0);
    expect(JSON.parse(readFileSync(creds(), 'utf8')).apiKey).toBe(KEY);
  });

  it('warns about a --key-file others can read, but still uses it', async () => {
    const keyPath = join(dir, 'loose.txt');
    writeFileSync(keyPath, KEY, { mode: 0o644 });
    const warned: string[] = [];
    expect(await runLogin({ keyFile: keyPath }, () => {}, creds(), tty({ warn: (m) => warned.push(m) }))).toBe(0);
    expect(warned.join('\n')).toMatch(/chmod 600/);
  });

  it('exits 2 on a missing --key-file, and writes nothing', async () => {
    expect(await runLogin({ keyFile: join(dir, 'nope.txt') }, () => {}, creds(), tty())).toBe(2);
    expect(existsSync(creds())).toBe(false);
  });

  it('refuses two sources at once rather than picking one', async () => {
    const warned: string[] = [];
    const code = await runLogin({ key: KEY, stdin: true }, () => {}, creds(), tty({ warn: (m) => warned.push(m) }));
    expect(code).toBe(2);
    expect(warned.join('\n')).toMatch(/--key, --stdin/);
    expect(existsSync(creds())).toBe(false);
  });

  it('exits 2 without writing when the prompt is cancelled', async () => {
    const code = await runLogin({}, () => {}, creds(), {
      isTty: () => true,
      warn: () => {},
      promptSecret: async () => {
        throw new Error('cancelled');
      },
    });
    expect(code).toBe(2);
    expect(existsSync(creds())).toBe(false);
  });

  // The CLI must stop teaching the unsafe form. Its own usage text is the thing
  // a confused user reads, so it is the thing asserted on.
  it('never offers `--key <the key>` as the headline usage', async () => {
    const lines: string[] = [];
    await runLogin({ key: 'not-a-key' }, (m) => lines.push(m), creds(), tty());
    expect(lines[0]).toBe('Usage: legalithm login            paste your key when asked');
    expect(lines.join('\n')).toMatch(/see the warning/);
  });
});
