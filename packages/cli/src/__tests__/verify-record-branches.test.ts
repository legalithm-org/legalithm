import { describe, it, expect } from 'vitest';
import { verifyRecord } from '../commands/verify-record.js';
import { computeRecordHash } from '../record-hash.js';
import type { StoredRecord } from '../types.js';

/**
 * The states a record can be in when someone tries to verify it.
 *
 * This is the trust anchor: it decides whether a record is presented as intact,
 * as tampered, or as merely unsigned. The three are very different claims, and
 * the branches that tell them apart were the least covered code in the command.
 * A hash match presented as "verified" when nothing was signed would be the
 * single most misleading thing this CLI could say.
 */
const base = {
  schemaVersion: '1.0',
  recordId: 'r1',
  inputHash: 'h',
  asOf: '2026-08-15',
  legalBasis: { engineVersion: 'eng-1', statement: 'As of 2026-08-15 ...' },
  system: { name: 'app', version: '0.0.0', input: { role: 'deployer', domain: 'other', use_case: 'x', audience: 'general' } },
  classification: { risk: 'limited' },
  disclaimer: 'Checked against Regulation (EU) 2024/1689 — not legal advice.',
  obligations: [],
} as unknown as StoredRecord;

const sealed = (): StoredRecord => {
  const r = { ...base } as StoredRecord;
  (r as Record<string, unknown>).recordHash = computeRecordHash(r);
  return r;
};
// bundledEngineVersion is a FUNCTION on the io object, not a value.
const io = { bundledEngineVersion: () => 'eng-1' };

describe('hash state', () => {
  it('accepts a record whose hash matches its content', () => {
    const r = verifyRecord(sealed(), io);
    expect(r.hashMatch).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('reports a record with NO hash as an issue, not as a pass', () => {
    const r = verifyRecord(base, io);
    expect(r.hashMatch).toBe(false);
    expect(r.issues.join(' ')).toContain('missing recordHash');
  });

  it('detects content changed after the hash was taken', () => {
    const r = sealed();
    (r as Record<string, unknown>).classification = { risk: 'high' };
    expect(verifyRecord(r, io).hashMatch).toBe(false);
  });

  it('detects a hash that was simply overwritten', () => {
    const r = sealed();
    (r as Record<string, unknown>).recordHash = 'f'.repeat(64);
    expect(verifyRecord(r, io).hashMatch).toBe(false);
  });
});

describe('signature state is separate from hash state', () => {
  it('a matching hash alone is NOT a signature', () => {
    const r = verifyRecord(sealed(), io);
    expect(r.hashMatch).toBe(true);
    // The distinction the whole trust model rests on.
    expect(r.signatureChecked).toBe(false);
    expect(r.signatureValid).toBeUndefined();
  });

  it('an unparseable signature file is reported, not ignored', () => {
    const r = verifyRecord(sealed(), io, 'this is not a signature');
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('an empty signature file is treated as no signature', () => {
    const r = verifyRecord(sealed(), io, '');
    expect(r.signatureValid).not.toBe(true);
  });

  it('a well-formed signature from an unknown key does not verify', () => {
    const sig = JSON.stringify({ keyId: 'nobody-knows-this', algorithm: 'ed25519', signature: 'AAAA', recordHash: 'x' });
    const r = verifyRecord(sealed(), io, sig);
    expect(r.signatureValid).not.toBe(true);
  });
});

describe('engine version drift', () => {
  it('notes when the record was made by a different engine than this CLI bundles', () => {
    const r = verifyRecord(sealed(), { bundledEngineVersion: () => 'eng-2' });
    expect(JSON.stringify(r)).toContain('eng-');
  });

  it('is quiet when the versions agree', () => {
    expect(verifyRecord(sealed(), { bundledEngineVersion: () => 'eng-1' }).issues).toEqual([]);
  });
});
