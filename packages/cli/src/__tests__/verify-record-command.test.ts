import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runVerifyRecord, verifyRecord, signaturePath } from '../commands/verify-record.js';
import { computeRecordHash, shortHash } from '../record-hash.js';
import { bundledEngineVersion } from '../engine-version.js';
import { signRecordHashForTest } from './test-signing-key.js';
import type { StoredRecord } from '../types.js';

function sampleRecord(over: Partial<StoredRecord> = {}): StoredRecord {
  const base: StoredRecord = {
    $schema: 'https://legalithm.com/schema/record/v1.json',
    schemaVersion: '1.0',
    recordId: 'r1',
    inputHash: 'hash-a',
    asOf: '2026-06-17',
    legalBasis: {
      instrument: 'Regulation (EU) 2024/1689',
      engineVersion: bundledEngineVersion(),
      statement: '...',
    },
    system: {
      name: 'X',
      version: '1.0.0',
      input: { role: 'provider', domain: 'employment', use_case: 'x', audience: 'workers' },
    },
    classification: { risk: 'high' },
    obligations: [],
    annex4: { sections: {} },
    disclaimer: 'Checked against Regulation (EU) 2024/1689 — not legal advice.',
    ...over,
  };
  return { ...base, recordHash: over.recordHash ?? computeRecordHash(base) };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legalithm-verify-record-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeBundle(record: StoredRecord, sig?: object) {
  const compliance = join(dir, 'compliance');
  mkdirSync(compliance, { recursive: true });
  writeFileSync(join(compliance, 'legalithm.json'), `${JSON.stringify(record, null, 2)}\n`);
  if (sig) {
    writeFileSync(signaturePath(dir), `${JSON.stringify(sig, null, 2)}\n`);
  }
}

describe('verifyRecord', () => {
  it('passes for a consistent record', () => {
    const record = sampleRecord();
    const result = verifyRecord(record, { bundledEngineVersion });
    expect(result.ok).toBe(true);
    expect(result.hashMatch).toBe(true);
    expect(result.engineMatch).toBe(true);
  });

  it('fails when recordHash was tampered', () => {
    const record = sampleRecord({ classification: { risk: 'minimal' }, recordHash: sampleRecord().recordHash });
    const result = verifyRecord(record, { bundledEngineVersion });
    expect(result.ok).toBe(false);
    expect(result.hashMatch).toBe(false);
  });

  it('validates a detached signature when present', () => {
    const record = sampleRecord();
    const sig = signRecordHashForTest(record.recordHash as string);
    const result = verifyRecord(record, { bundledEngineVersion }, JSON.stringify(sig));
    expect(result.ok).toBe(true);
    expect(result.signatureValid).toBe(true);
  });

  it('fails when detached signature does not match', () => {
    const record = sampleRecord();
    const sig = signRecordHashForTest('deadbeef');
    const result = verifyRecord(record, { bundledEngineVersion }, JSON.stringify(sig));
    expect(result.ok).toBe(false);
    expect(result.signatureValid).toBe(false);
  });
});

describe('runVerifyRecord', () => {
  it('exits 2 when no record exists', () => {
    const code = runVerifyRecord(
      {
        readRecord: () => null,
        readSignature: () => null,
        bundledEngineVersion,
        log: () => {},
        error: () => {},
      },
      { cwd: dir },
    );
    expect(code).toBe(2);
  });

  it('exits 0 for a valid on-disk bundle with signature', () => {
    const record = sampleRecord();
    const sig = signRecordHashForTest(record.recordHash as string);
    writeBundle(record, sig);
    let out = '';
    const code = runVerifyRecord(
      {
        readRecord: (d) => JSON.parse(readFileSync(join(d, 'compliance', 'legalithm.json'), 'utf8')) as StoredRecord,
        readSignature: (d) => {
          const p = signaturePath(d);
          return existsSync(p) ? readFileSync(p, 'utf8') : null;
        },
        bundledEngineVersion,
        log: (m) => (out += `${m}\n`),
        error: (m) => (out += `${m}\n`),
      },
      { cwd: dir, json: true },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).signatureValid).toBe(true);
  });
});

describe('bundledEngineVersion', () => {
  it('matches the hash of the bundled risk_map.json corpus', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '../../data/risk_map.json'), 'utf8');
    expect(bundledEngineVersion()).toBe(shortHash(JSON.parse(raw)));
  });
});
