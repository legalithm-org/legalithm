// Pure drift detection between a stored record and a freshly-generated one.
// Deliberately ignores `asOf` (regenerating on a later day is expected and not drift)
// and compares only the three things that matter:
//   - inputHash      -> the system.input was edited (input drift)
//   - engineVersion  -> the rules changed server-side; record is stale vs current law (rule drift)
//   - classification -> the resulting risk tier changed (risk drift, highest severity)

import type { StoredRecord } from './types.js';

export type DriftType = 'input' | 'rule' | 'risk';

export interface DriftEntry {
  type: DriftType;
  from: string;
  to: string;
}

export type DriftStatus = 'in-sync' | 'drift';

export interface DriftReport {
  status: DriftStatus;
  drift: DriftEntry[];
}

export function computeDrift(stored: StoredRecord, fresh: StoredRecord): DriftReport {
  const drift: DriftEntry[] = [];

  if (stored.inputHash !== fresh.inputHash) {
    drift.push({ type: 'input', from: stored.inputHash, to: fresh.inputHash });
  }
  if (stored.legalBasis.engineVersion !== fresh.legalBasis.engineVersion) {
    drift.push({ type: 'rule', from: stored.legalBasis.engineVersion, to: fresh.legalBasis.engineVersion });
  }
  if (stored.classification.risk !== fresh.classification.risk) {
    drift.push({ type: 'risk', from: stored.classification.risk, to: fresh.classification.risk });
  }

  return { status: drift.length === 0 ? 'in-sync' : 'drift', drift };
}

/**
 * Decide whether a drift report should fail CI, given a `--fail-on` policy.
 *  - 'risk-or-rule' (default): fail on risk OR rule drift (the ones that mean "stale vs law")
 *  - 'any': fail on any drift incl. a hand-edited input
 *  - 'risk': fail only on a changed risk tier
 *  - 'never': never fail (report only)
 */
export function shouldFail(report: DriftReport, failOn: string): boolean {
  if (report.status === 'in-sync') return false;
  const types = new Set(report.drift.map((d) => d.type));
  switch (failOn) {
    case 'never':
      return false;
    case 'any':
      return true;
    case 'risk':
      return types.has('risk');
    case 'risk-or-rule':
    default:
      return types.has('risk') || types.has('rule');
  }
}
