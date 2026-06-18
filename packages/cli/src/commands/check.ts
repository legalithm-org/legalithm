import { readRecord } from '../record-io.js';
import { computeDrift, shouldFail, type DriftReport } from '../drift.js';
import type { StoredRecord } from '../types.js';

export interface RunCheckDeps {
  cwd: string;
  /** Regenerate a fresh record from the stored system.input (injected → calls the API). */
  regenerate: (stored: StoredRecord) => Promise<StoredRecord>;
  failOn: string;
  json: boolean;
  log?: (msg: string) => void;
}

export interface RunCheckResult {
  exitCode: number;
  report?: DriftReport;
}

/**
 * Exit codes: 0 in-sync · 1 drift ≥ fail-on threshold · 2 no record · 3 API/network/auth error.
 */
export async function runCheck(deps: RunCheckDeps): Promise<RunCheckResult> {
  const log = deps.log ?? ((m: string) => console.log(m));

  const stored = readRecord(deps.cwd);
  if (!stored) {
    log('No compliance/legalithm.json found — run `legalithm init` first.');
    return { exitCode: 2 };
  }

  let fresh: StoredRecord;
  try {
    fresh = await deps.regenerate(stored);
  } catch (e) {
    log(`Could not verify compliance: ${(e as Error).message}`);
    return { exitCode: 3 };
  }

  const report = computeDrift(stored, fresh);

  if (deps.json) {
    log(JSON.stringify({ status: report.status, drift: report.drift, legalBasis: fresh.legalBasis.statement }, null, 2));
  } else if (report.status === 'in-sync') {
    log(`✓ compliance/legalithm.json is in sync. ${fresh.legalBasis.statement}`);
  } else {
    log('✗ compliance drift detected:');
    for (const d of report.drift) log(`  - ${d.type} drift: ${d.from} → ${d.to}`);
    log(fresh.legalBasis.statement);
  }

  return { exitCode: shouldFail(report, deps.failOn) ? 1 : 0, report };
}
