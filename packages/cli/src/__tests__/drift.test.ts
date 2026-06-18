import { describe, it, expect } from 'vitest';
import { computeDrift, shouldFail } from '../drift.js';
import type { StoredRecord } from '../types.js';

function rec(over: Partial<StoredRecord> = {}): StoredRecord {
  return {
    schemaVersion: '1.0',
    recordId: 'r1',
    inputHash: 'hash-a',
    asOf: '2026-06-17',
    legalBasis: { engineVersion: 'eng-1', statement: '...' },
    system: { name: 'X', version: '1.0.0', input: { role: 'provider', domain: 'employment', use_case: 'x', audience: 'workers' } },
    classification: { risk: 'high' },
    ...over,
  };
}

describe('computeDrift', () => {
  it('reports in-sync for identical records (ignoring asOf)', () => {
    const a = rec();
    const b = rec({ asOf: '2027-01-01' }); // later date alone is NOT drift
    expect(computeDrift(a, b)).toEqual({ status: 'in-sync', drift: [] });
  });

  it('detects input drift', () => {
    const report = computeDrift(rec(), rec({ inputHash: 'hash-b' }));
    expect(report.status).toBe('drift');
    expect(report.drift).toContainEqual({ type: 'input', from: 'hash-a', to: 'hash-b' });
  });

  it('detects rule drift (engine version changed server-side)', () => {
    const report = computeDrift(rec(), rec({ legalBasis: { engineVersion: 'eng-2', statement: '...' } }));
    expect(report.drift).toContainEqual({ type: 'rule', from: 'eng-1', to: 'eng-2' });
  });

  it('detects risk drift', () => {
    const report = computeDrift(rec(), rec({ classification: { risk: 'limited' } }));
    expect(report.drift).toContainEqual({ type: 'risk', from: 'high', to: 'limited' });
  });

  it('reports multiple drift types at once', () => {
    const report = computeDrift(
      rec(),
      rec({ inputHash: 'hash-b', classification: { risk: 'minimal' } }),
    );
    expect(report.drift.map((d) => d.type).sort()).toEqual(['input', 'risk']);
  });
});

describe('shouldFail', () => {
  const inSync = { status: 'in-sync' as const, drift: [] };
  const inputOnly = { status: 'drift' as const, drift: [{ type: 'input' as const, from: 'a', to: 'b' }] };
  const ruleOnly = { status: 'drift' as const, drift: [{ type: 'rule' as const, from: '1', to: '2' }] };
  const riskOnly = { status: 'drift' as const, drift: [{ type: 'risk' as const, from: 'high', to: 'low' }] };

  it('never fails when in sync', () => {
    for (const p of ['any', 'risk', 'rule', 'risk-or-rule', 'never']) {
      expect(shouldFail(inSync, p)).toBe(false);
    }
  });

  it('default (risk-or-rule) fails on risk or rule, not on input alone', () => {
    expect(shouldFail(inputOnly, 'risk-or-rule')).toBe(false);
    expect(shouldFail(ruleOnly, 'risk-or-rule')).toBe(true);
    expect(shouldFail(riskOnly, 'risk-or-rule')).toBe(true);
  });

  it('"any" fails on any drift incl. input', () => {
    expect(shouldFail(inputOnly, 'any')).toBe(true);
  });

  it('"risk" fails only on risk drift', () => {
    expect(shouldFail(ruleOnly, 'risk')).toBe(false);
    expect(shouldFail(riskOnly, 'risk')).toBe(true);
  });

  it('"never" never fails', () => {
    expect(shouldFail(riskOnly, 'never')).toBe(false);
  });
});
