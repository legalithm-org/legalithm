/**
 * Detached record signatures (compliance/legalithm.json.sig).
 * Signed payload: the recordHash hex digest (UTF-8).
 */

import { createPublicKey, verify, type KeyObject } from 'crypto';

/**
 * Well-known verification keys shipped with the CLI.
 *
 * These are PUBLIC halves only. The matching private key must never live in
 * this repository: it is the only thing standing between a real signature and
 * a forged one. A prior revision shipped the private key for
 * legalithm-record-v1 here as a "test-only" constant, which made every
 * signature under that keyId forgeable by anyone who read the source — in the
 * one package whose job is proving a record was not tampered with.
 *
 * Tests must not be the reason a private key ships. They register an ephemeral
 * key of their own instead, via registerVerificationKey().
 */
const PUBLIC_KEYS_PEM: Record<string, string> = {
  'legalithm-record-v1': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANCWKqS0RKGO/rS8Dq7QWxJGYIGe8ZBw4c8WT8/DQQ8M=
-----END PUBLIC KEY-----`,
};

/**
 * Verification keys registered at runtime: tests, and organisations that sign
 * records with their own key. Built-ins can never be overridden, so a caller
 * cannot silently swap the trust anchor for legalithm-record-v1.
 */
const additionalPublicKeys = new Map<string, string>();

/**
 * Key ids Legalithm ships as trust anchors. Nothing outside this repository can
 * sign under one, because the matching private half does not exist here and
 * never will — see docs/RECORD-SIGNING.md. Exported so the signing path can
 * refuse them by name rather than by duplicating the list.
 */
export const BUILT_IN_KEY_IDS: readonly string[] = Object.freeze(Object.keys(PUBLIC_KEYS_PEM));

export function isBuiltInKeyId(keyId: string): boolean {
  return keyId in PUBLIC_KEYS_PEM;
}

export function registerVerificationKey(keyId: string, publicKeyPem: string): void {
  if (keyId in PUBLIC_KEYS_PEM) {
    throw new Error(`Refusing to override the built-in verification key: ${keyId}`);
  }
  additionalPublicKeys.set(keyId, publicKeyPem);
}

export function clearRegisteredVerificationKeys(): void {
  additionalPublicKeys.clear();
}

export interface DetachedRecordSignature {
  algorithm: 'Ed25519';
  keyId: string;
  signature: string;
}

export function parseSignatureFile(raw: string): DetachedRecordSignature {
  const parsed = JSON.parse(raw) as Partial<DetachedRecordSignature>;
  if (parsed.algorithm !== 'Ed25519') {
    throw new Error(`Unsupported signature algorithm: ${String(parsed.algorithm)}`);
  }
  if (!parsed.keyId || typeof parsed.keyId !== 'string') {
    throw new Error('Signature file missing keyId');
  }
  if (!parsed.signature || typeof parsed.signature !== 'string') {
    throw new Error('Signature file missing signature');
  }
  return { algorithm: 'Ed25519', keyId: parsed.keyId, signature: parsed.signature };
}

function publicKeyFor(keyId: string): KeyObject {
  const pem = PUBLIC_KEYS_PEM[keyId] ?? additionalPublicKeys.get(keyId);
  if (!pem) {
    throw new Error(`Unknown signature keyId: ${keyId}`);
  }
  return createPublicKey(pem);
}

/** Returns true when the detached signature matches recordHash. */
export function verifyDetachedSignature(recordHash: string, sig: DetachedRecordSignature): boolean {
  const key = publicKeyFor(sig.keyId);
  return verify(null, Buffer.from(recordHash, 'utf8'), key, Buffer.from(sig.signature, 'base64'));
}

// The signing half lives in record-signing.ts, not here. Not because signing
// code is dangerous — it signs with a key the user supplies, exactly as gpg and
// ssh-keygen do — but because this module is the trust anchor, and the thing
// that decides whether a signature is genuine should not also be the thing that
// makes them. The original hazard was shipping OUR private key, which is a
// different mistake and is now guarded by
// __tests__/lib/no-private-keys-in-source.test.ts.
//
// Tests generate their own keypair — see __tests__/test-signing-key.ts.
