import { writeRecordBundle } from '../record-io.js';
import type { StoredRecord, UseCase } from '../types.js';

export interface RunInitDeps {
  cwd: string;
  system: { name: string; version: string };
  input: UseCase;
  /** Generate the record (injected → calls the API). */
  generate: (system: { name: string; version: string }, input: UseCase) => Promise<StoredRecord>;
  log?: (msg: string) => void;
}

export interface RunInitResult {
  exitCode: number;
  record?: StoredRecord;
}

export async function runInit(deps: RunInitDeps): Promise<RunInitResult> {
  const log = deps.log ?? ((m: string) => console.log(m));

  let record: StoredRecord;
  try {
    record = await deps.generate(deps.system, deps.input);
  } catch (e) {
    log(`Could not generate the compliance record: ${(e as Error).message}`);
    return { exitCode: 3 };
  }

  writeRecordBundle(deps.cwd, record);
  log('✓ Wrote compliance/legalithm.json (+ annex-iv.md, checklist.md)');
  log(`  Risk: ${record.classification.risk}`);
  if (record.classification.reviewRequired) {
    log('  ⚠ Low confidence — this classification is uncertain and should be confirmed with legal review.');
  }
  log(`  ${record.legalBasis.statement}`);
  return { exitCode: 0, record };
}
