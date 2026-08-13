/**
 * `legalithm sign-record` — sign compliance/legalithm.json with YOUR key.
 *
 * Legalithm never holds a signing key. The organisation making the compliance
 * claim signs it, and the signature is verifiable by anyone, offline, with no
 * call to Legalithm and no trust in Legalithm's key custody. See
 * docs/RECORD-SIGNING.md for why that is the only version of this worth having.
 */

import { computeRecordHash } from '../record-hash.js';
import {
  loadSigningKey,
  publicKeyPemFor,
  signRecordHash,
  renderSignatureFile,
  parseVerificationKeys,
  renderVerificationKeys,
} from '../record-signing.js';
import { RECORD_DIR, RECORD_FILE, VERIFICATION_KEYS_FILE } from '../record-io.js';
import { SIGNATURE_FILE } from './verify-record.js';
import type { StoredRecord } from '../types.js';

export interface SignRecordIo {
  readRecord: (cwd: string) => StoredRecord | null;
  readKeyFile: (path: string) => string;
  /** Unix mode bits, or null where unavailable (Windows, unreadable stat). */
  keyFileMode: (path: string) => number | null;
  readVerificationKeys: (cwd: string) => string | null;
  writeSignature: (cwd: string, contents: string) => void;
  writeVerificationKeys: (cwd: string, contents: string) => void;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export interface SignRecordParams {
  cwd: string;
  keyPath?: string;
  keyId?: string;
  json?: boolean;
}

export interface SignRecordResult {
  ok: boolean;
  recordHash?: string;
  keyId?: string;
  publicKeyPem?: string;
  warnings: string[];
  issues: string[];
}

export function runSignRecord(io: SignRecordIo, params: SignRecordParams): number {
  const result: SignRecordResult = { ok: false, warnings: [], issues: [] };

  const fail = (msg: string, code: number): number => {
    result.issues.push(msg);
    if (params.json) io.log(JSON.stringify(result, null, 2));
    else io.error(`✗ ${msg}`);
    return code;
  };

  if (!params.keyPath) {
    return fail(
      'No signing key. Pass --key <path> (or set LEGALITHM_SIGNING_KEY to a path). ' +
        'The key is read from a file, never from an argument, so it cannot end up in shell history.',
      2,
    );
  }
  if (!params.keyId) {
    return fail(
      'No --key-id. This names the key in the signature and is what an auditor looks up, ' +
        'for example "acme-gmbh-2026".',
      2,
    );
  }

  const record = io.readRecord(params.cwd);
  if (!record) {
    return fail(`No ${RECORD_DIR}/${RECORD_FILE} found — run \`legalithm init\` first.`, 2);
  }

  // Never sign a record that does not verify. A signature over a tampered body
  // is worse than no signature: it launders the tampering as attested.
  const recomputed = computeRecordHash(record);
  const storedHash = typeof record.recordHash === 'string' ? record.recordHash : undefined;
  if (storedHash === undefined) {
    return fail('Record is missing recordHash — regenerate it with a current CLI before signing.', 1);
  }
  if (storedHash !== recomputed) {
    return fail(
      'Refusing to sign: recordHash does not match the record body, so the record was edited ' +
        `after generation. stored=${storedHash.slice(0, 16)}… recomputed=${recomputed.slice(0, 16)}…`,
      1,
    );
  }

  let keyPem: string;
  try {
    keyPem = io.readKeyFile(params.keyPath);
  } catch (e) {
    return fail(`Could not read the key file ${params.keyPath}: ${(e as Error).message}`, 2);
  }

  // Mirrors ssh's complaint rather than its refusal: a group-readable signing
  // key is a real problem, but hard-failing here would break CI runners that
  // cannot control the mode of a mounted secret.
  const mode = io.keyFileMode(params.keyPath);
  if (mode !== null && (mode & 0o077) !== 0) {
    result.warnings.push(
      `${params.keyPath} is readable by group or other (mode ${(mode & 0o777).toString(8)}). ` +
        'Anyone who can read it can forge your signatures:  chmod 600 ' +
        params.keyPath,
    );
  }

  let signature;
  let publicKeyPem: string;
  try {
    const privateKey = loadSigningKey(keyPem);
    publicKeyPem = publicKeyPemFor(privateKey);
    signature = signRecordHash(storedHash, privateKey, params.keyId);
  } catch (e) {
    return fail((e as Error).message, 1);
  }

  // Publish the public half next to the record, merging rather than replacing:
  // an organisation that rotates keys still needs the old one to verify records
  // signed before the rotation.
  let keysFile = { keys: {} as Record<string, string> };
  const existingRaw = io.readVerificationKeys(params.cwd);
  if (existingRaw) {
    try {
      keysFile = parseVerificationKeys(existingRaw);
    } catch (e) {
      return fail(
        `${RECORD_DIR}/${VERIFICATION_KEYS_FILE} is present but unreadable: ${(e as Error).message}`,
        1,
      );
    }
  }
  const previous = keysFile.keys[params.keyId];
  if (previous && previous.trim() !== publicKeyPem.trim()) {
    return fail(
      `Key id "${params.keyId}" is already published with a DIFFERENT public key. Reusing an id ` +
        'for a new key silently invalidates every record signed under the old one. Pick a new id.',
      1,
    );
  }
  keysFile.keys[params.keyId] = publicKeyPem;

  io.writeSignature(params.cwd, renderSignatureFile(signature));
  io.writeVerificationKeys(params.cwd, renderVerificationKeys(keysFile));

  result.ok = true;
  result.recordHash = storedHash;
  result.keyId = params.keyId;
  result.publicKeyPem = publicKeyPem;

  if (params.json) {
    io.log(JSON.stringify(result, null, 2));
    return 0;
  }

  io.log(`✓ Signed ${RECORD_DIR}/${RECORD_FILE} as "${params.keyId}"`);
  io.log(`  ${RECORD_DIR}/${SIGNATURE_FILE}`);
  io.log(`  ${RECORD_DIR}/${VERIFICATION_KEYS_FILE}  (public key, safe to commit)`);
  for (const w of result.warnings) io.log(`  ⚠ ${w}`);
  io.log('');
  io.log('  Commit all three. Anyone can then run `legalithm verify-record` with no key and');
  io.log('  no network. Give your auditor the key fingerprint through a channel other than');
  io.log('  this repository, or they are trusting the same repo they are auditing.');

  return 0;
}
