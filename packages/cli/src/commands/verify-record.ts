/**
 * `legalithm verify-record` — offline integrity check for compliance/legalithm.json.
 * Recomputes recordHash, compares engine version against the bundled rule corpus,
 * and validates a detached Ed25519 signature when compliance/legalithm.json.sig exists.
 */

import { join } from 'path';
import { computeRecordHash } from '../record-hash.js';
import { bundledEngineVersion } from '../engine-version.js';
import { parseSignatureFile, verifyDetachedSignature } from '../record-signature.js';
import { readRecord, RECORD_DIR, RECORD_FILE } from '../record-io.js';
import type { StoredRecord } from '../types.js';

export const SIGNATURE_FILE = 'legalithm.json.sig';

export interface VerifyRecordResult {
  ok: boolean;
  recordHash: string;
  hashMatch: boolean;
  engineMatch: boolean;
  signatureChecked: boolean;
  signatureValid?: boolean;
  issues: string[];
}

export interface VerifyRecordIo {
  readRecord: (cwd: string) => StoredRecord | null;
  readSignature: (cwd: string) => string | null;
  bundledEngineVersion: () => string;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export function verifyRecord(record: StoredRecord, io: Pick<VerifyRecordIo, 'bundledEngineVersion'>, sigRaw?: string | null): VerifyRecordResult {
  const issues: string[] = [];
  const recomputed = computeRecordHash(record);
  const storedHash = typeof record.recordHash === 'string' ? record.recordHash : undefined;
  const hashMatch = storedHash === undefined ? false : storedHash === recomputed;

  if (storedHash === undefined) {
    issues.push('record is missing recordHash (regenerate with a current CLI)');
  } else if (!hashMatch) {
    issues.push('recordHash mismatch — the record body was edited after generation');
  }

  const bundled = io.bundledEngineVersion();
  const engineMatch = record.legalBasis.engineVersion === bundled;
  if (!engineMatch) {
    issues.push(
      `engine version ${record.legalBasis.engineVersion} differs from bundled corpus ${bundled} (rules may have changed)`,
    );
  }

  let signatureChecked = false;
  let signatureValid: boolean | undefined;
  if (sigRaw) {
    signatureChecked = true;
    try {
      const sig = parseSignatureFile(sigRaw);
      if (storedHash === undefined) {
        issues.push('cannot verify signature without a valid recordHash');
        signatureValid = false;
      } else {
        signatureValid = verifyDetachedSignature(storedHash, sig);
        if (!signatureValid) {
          issues.push('detached signature does not match recordHash');
        }
      }
    } catch (e) {
      signatureValid = false;
      issues.push(`signature parse/verify error: ${(e as Error).message}`);
    }
  }

  const ok = hashMatch && (!signatureChecked || signatureValid === true);
  return { ok, recordHash: recomputed, hashMatch, engineMatch, signatureChecked, signatureValid, issues };
}

export interface VerifyRecordParams {
  cwd: string;
  json?: boolean;
}

export function runVerifyRecord(io: VerifyRecordIo, params: VerifyRecordParams): number {
  const record = io.readRecord(params.cwd);
  if (!record) {
    io.error(`No ${RECORD_DIR}/${RECORD_FILE} found — run \`legalithm init\` first.`);
    return 2;
  }

  const sigRaw = io.readSignature(params.cwd);
  const result = verifyRecord(record, io, sigRaw);

  if (params.json) {
    io.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    io.log(`✓ Record integrity OK. recordHash=${result.recordHash.slice(0, 16)}…`);
    if (result.signatureChecked && result.signatureValid) {
      io.log('  Detached signature: valid');
    }
    if (!result.engineMatch) {
      io.log(`  ⚠ ${result.issues.find((i) => i.startsWith('engine version'))}`);
    }
  } else {
    io.error('✗ Record verification failed:');
    for (const issue of result.issues) io.error(`  - ${issue}`);
    io.log(`  Recomputed recordHash: ${result.recordHash}`);
  }

  return result.ok ? 0 : 1;
}

export function signaturePath(cwd: string): string {
  return join(cwd, RECORD_DIR, SIGNATURE_FILE);
}
