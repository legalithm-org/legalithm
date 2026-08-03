import { describe, it, expect } from 'vitest';
import { driftReportToSarif, noRecordSarif, SARIF_SCHEMA } from '../sarif.js';

describe('driftReportToSarif', () => {
  it('emits an empty results array when in sync', () => {
    const sarif = driftReportToSarif({ status: 'in-sync', drift: [] }, '0.5.0');
    expect(sarif.$schema).toBe(SARIF_SCHEMA);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.tool.driver.name).toBe('legalithm');
    expect(sarif.runs[0]?.results).toEqual([]);
  });

  it('maps risk drift to an error-level SARIF result', () => {
    const sarif = driftReportToSarif(
      {
        status: 'drift',
        drift: [{ type: 'risk', from: 'high', to: 'limited' }],
      },
      '0.5.0',
    );
    expect(sarif.runs[0]?.results).toEqual([
      expect.objectContaining({
        ruleId: 'legalithm/risk-drift',
        level: 'error',
        message: { text: 'risk drift: high → limited' },
        locations: [
          expect.objectContaining({
            physicalLocation: { artifactLocation: { uri: 'compliance/legalithm.json' } },
          }),
        ],
      }),
    ]);
  });

  it('maps input drift to warning and rule drift to error', () => {
    const sarif = driftReportToSarif(
      {
        status: 'drift',
        drift: [
          { type: 'input', from: 'a', to: 'b' },
          { type: 'rule', from: 'eng-1', to: 'eng-2' },
        ],
      },
      '0.5.0',
    );
    const levels = sarif.runs[0]?.results.map((r) => r.level);
    expect(levels).toEqual(['warning', 'error']);
  });
});

describe('noRecordSarif', () => {
  it('emits a no-record error result', () => {
    const sarif = noRecordSarif('0.5.0');
    expect(sarif.runs[0]?.results[0]).toEqual(
      expect.objectContaining({
        ruleId: 'legalithm/no-record',
        level: 'error',
      }),
    );
  });
});
