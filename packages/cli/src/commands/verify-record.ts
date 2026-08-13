/**
 * `legalithm verify-record` — offline integrity check for compliance/legalithm.json.
 * Recomputes recordHash, compares engine version against the bundled rule corpus,
 * and validates a detached Ed25519 signature when compliance/legalithm.json.sig exists.
 */

import { join } from 'path';
import { computeRecordHash } from '../record-hash.js';
import { parseSignatureFile, verifyDetachedSignature, isBuiltInKeyId, registerVerificationKey } from '../record-signature.js';
import { parseVerificationKeys } from '../record-signing.js';
import { RECORD_DIR, RECORD_FILE, VERIFICATION_KEYS_FILE } from '../record-io.js';
import type { StoredRecord } from '../types.js';

export const SIGNATURE_FILE = 'legalithm.json.sig';

export interface VerifyRecordResult {
  ok: boolean;
  recordHash: string;
  hashMatch: boolean;
  engineMatch: boolean;
  signatureChecked: boolean;
  signatureValid?: boolean;
  signatureKeyId?: string;
  /**
   * Where the public key came from. 'repo' means it was read out of the same
   * repository being verified, which proves the record is internally consistent
   * and says nothing about who issued it until the key is confirmed elsewhere.
   */
  signatureKeySource?: 'builtin' | 'repo' | 'unknown';
  issues: string[];
}

export interface VerifyRecordIo {
  readRecord: (cwd: string) => StoredRecord | null;
  readSignature: (cwd: string) => string | null;
  /** Optional: compliance/verification-keys.json, published by `sign-record`. */
  readVerificationKeys?: (cwd: string) => string | null;
  bundledEngineVersion: () => string;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export function verifyRecord(
  record: StoredRecord,
  io: Pick<VerifyRecordIo, 'bundledEngineVersion'>,
  sigRaw?: string | null,
  repoKeyIds: string[] = [],
): VerifyRecordResult {
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
  let signatureKeyId: string | undefined;
  let signatureKeySource: 'builtin' | 'repo' | 'unknown' | undefined;
  if (sigRaw) {
    signatureChecked = true;
    try {
      const sig = parseSignatureFile(sigRaw);
      signatureKeyId = sig.keyId;
      signatureKeySource = isBuiltInKeyId(sig.keyId)
        ? 'builtin'
        : repoKeyIds.includes(sig.keyId)
          ? 'repo'
          : 'unknown';
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
  return {
    ok,
    recordHash: recomputed,
    hashMatch,
    engineMatch,
    signatureChecked,
    signatureValid,
    signatureKeyId,
    signatureKeySource,
    issues,
  };
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

  // Load any public keys the organisation published next to the record. Built-in
  // ids are refused by registerVerificationKey, so a repo cannot swap the
  // Legalithm trust anchor by shipping a file.
  const repoKeyIds: string[] = [];
  const keysRaw = io.readVerificationKeys?.(params.cwd) ?? null;
  if (keysRaw) {
    try {
      for (const [keyId, pem] of Object.entries(parseVerificationKeys(keysRaw).keys)) {
        try {
          registerVerificationKey(keyId, pem);
          repoKeyIds.push(keyId);
        } catch {
          // Built-in id, or already registered. Either way the built-in wins.
        }
      }
    } catch (e) {
      io.error(`  ⚠ ${RECORD_DIR}/${VERIFICATION_KEYS_FILE} could not be read: ${(e as Error).message}`);
    }
  }

  const sigRaw = io.readSignature(params.cwd);
  const result = verifyRecord(record, io, sigRaw, repoKeyIds);

  if (params.json) {
    io.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    io.log(`✓ Record integrity OK. recordHash=${result.recordHash.slice(0, 16)}…`);
    if (result.signatureChecked && result.signatureValid) {
      io.log(`  Detached signature: valid (key "${result.signatureKeyId}")`);
      if (result.signatureKeySource === 'repo') {
        io.log('  ⓘ That public key came from this repository, so this proves the record was');
        io.log('    signed by whoever holds that key, not who that is. Confirm the key with the');
        io.log('    organisation through another channel before treating it as proof of issuer.');
      }
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
