import { describe, it, expect } from 'vitest';
import { computeRecordHash } from '../record-hash.js';
import type { StoredRecord } from '../types.js';

const base = {
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
} as unknown as StoredRecord;

const withAnnex = (annex4: unknown) => ({ ...base, annex4 }) as unknown as StoredRecord;

/**
 * The record hash is what `check` compares to decide whether a build passes.
 * annex4ForHash strips the date stamps that Annex IV regenerates on every run,
 * so two records with identical substance hash the same. If those stamps leaked
 * into the hash, every CI run would report drift and users would learn to
 * ignore the command.
 *
 * The stripping branches were uncovered: no test passed an Annex IV with
 * timestamps, or with the fields absent, or with a non-object in their place.
 */
describe('record hash — Annex IV date stripping', () => {
  it('ignores section lastUpdated stamps', () => {
    const a = withAnnex({ sections: { a: { title: 'System Overview', content: 'b', lastUpdated: '2026-06-17' } } });
    const b = withAnnex({ sections: { a: { title: 'System Overview', content: 'b', lastUpdated: '2026-08-05' } } });
    expect(computeRecordHash(a)).toBe(computeRecordHash(b));
  });

  it('ignores metadata generatedAt', () => {
    const a = withAnnex({ metadata: { generatedAt: '2026-06-17T00:00:00Z', author: 'legalithm' } });
    const b = withAnnex({ metadata: { generatedAt: '2026-08-05T09:00:00Z', author: 'legalithm' } });
    expect(computeRecordHash(a)).toBe(computeRecordHash(b));
  });

  it('still reflects real Annex IV content changes', () => {
    const a = withAnnex({ sections: { a: { title: 'System Overview', content: 'b' } } });
    const b = withAnnex({ sections: { a: { title: 'System Overview', content: 'CHANGED' } } });
    expect(computeRecordHash(a)).not.toBe(computeRecordHash(b));
  });

  it('handles an Annex IV with no sections and no metadata', () => {
    expect(() => computeRecordHash(withAnnex({}))).not.toThrow();
  });

  it('handles metadata that is not an object', () => {
    // The guard is `doc.metadata && typeof doc.metadata === 'object'`; both
    // halves need exercising or a malformed record throws inside the hasher.
    expect(() => computeRecordHash(withAnnex({ metadata: 'not-an-object' }))).not.toThrow();
    expect(() => computeRecordHash(withAnnex({ metadata: null }))).not.toThrow();
  });

  it('handles annex4 being absent or a primitive', () => {
    expect(() => computeRecordHash(base)).not.toThrow();
    expect(() => computeRecordHash(withAnnex(null))).not.toThrow();
    expect(() => computeRecordHash(withAnnex('nope'))).not.toThrow();
  });

  it('is stable across repeated calls on the same record', () => {
    const record = withAnnex({ sections: { a: { title: 'System Overview', content: 'b' } } });
    expect(computeRecordHash(record)).toBe(computeRecordHash(record));
  });
});
