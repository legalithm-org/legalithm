import { describe, it, expect } from 'vitest';
import { computeRecordHash } from '../record-hash.js';
import type { StoredRecord } from '../types.js';

function rec(over: Partial<StoredRecord> = {}): StoredRecord {
  const base: StoredRecord = {
    $schema: 'https://legalithm.com/schema/record/v1.json',
    schemaVersion: '1.0',
    recordId: 'r1',
    inputHash: 'hash-a',
    asOf: '2026-06-17',
    legalBasis: {
      instrument: 'Regulation (EU) 2024/1689',
      engineVersion: 'eng-1',
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

describe('computeRecordHash (CLI)', () => {
  it('is stable across asOf changes', () => {
    const a = rec();
    const b = rec({ asOf: '2027-01-01' });
    expect(a.recordHash).toBe(b.recordHash);
  });

  it('changes when classification risk is edited', () => {
    const base = rec();
    const edited = rec({ classification: { risk: 'minimal' } });
    expect(edited.recordHash).not.toBe(base.recordHash);
  });
});
