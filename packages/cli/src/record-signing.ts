/**
 * Producing detached record signatures.
 *
 * Deliberately a separate module from record-signature.ts. That one is the
 * verifier and ships as the trust anchor; nothing capable of producing a
 * signature belongs in the module whose only job is deciding whether one is
 * genuine.
 *
 * Legalithm does not hold a signing key and does not sign records. The
 * organisation making the compliance claim signs it with its own key, and
 * anyone can verify that offline with no vendor in the loop. That is the whole
 * point: a vendor-held key would make "independently verifiable" mean
 * "verifiable if you trust the vendor's key custody", which is the thing it is
 * supposed to replace. Reasoning and the options considered are in
 * docs/RECORD-SIGNING.md.
 */

import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'crypto';
import {
  isBuiltInKeyId,
  verifyDetachedSignature,
  registerVerificationKey,
  type DetachedRecordSignature,
} from './record-signature.js';

/**
 * Parse an Ed25519 private key from PEM.
 *
 * Rejects every other key type by name rather than letting `sign()` fail later
 * with a generic error: an RSA key here is a user who thinks they have set up
 * signing and has not.
 */
export function loadSigningKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch (e) {
    throw new Error(
      `Could not read a private key from that file: ${(e as Error).message}. ` +
        'Generate one with:  openssl genpkey -algorithm ed25519 -out legalithm-signing.key',
    );
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `Record signatures are Ed25519; that key is ${String(key.asymmetricKeyType)}. ` +
        'Generate one with:  openssl genpkey -algorithm ed25519 -out legalithm-signing.key',
    );
  }
  return key;
}

/** The public half, in the SPKI PEM form registerVerificationKey expects. */
export function publicKeyPemFor(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
}

/**
 * Sign a recordHash under a caller-supplied key id.
 *
 * The signature is verified against the derived public half before it is
 * returned. Producing a signature and reporting success without checking that
 * it verifies is precisely the failure this whole feature exists to prevent,
 * and it costs microseconds to rule out.
 */
export function signRecordHash(
  recordHash: string,
  privateKey: KeyObject,
  keyId: string,
): DetachedRecordSignature {
  if (isBuiltInKeyId(keyId)) {
    throw new Error(
      `"${keyId}" is a built-in Legalithm trust anchor and cannot be signed under. ` +
        'Choose a key id that identifies your organisation, for example "acme-gmbh-2026".',
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(keyId)) {
    throw new Error(
      `Invalid key id "${keyId}": use 3-64 characters of letters, digits, dot, dash or underscore.`,
    );
  }

  const signature = sign(null, Buffer.from(recordHash, 'utf8'), privateKey).toString('base64');
  const detached: DetachedRecordSignature = { algorithm: 'Ed25519', keyId, signature };

  // Round-trip against the real verifier, under a throwaway id so this never
  // mutates the caller's trust store.
  const probeId = `${keyId}.__signing-selfcheck`;
  registerVerificationKey(probeId, publicKeyPemFor(privateKey));
  const roundTrips = verifyDetachedSignature(recordHash, { ...detached, keyId: probeId });
  if (!roundTrips) {
    throw new Error('Refusing to write a signature that does not verify against its own key.');
  }

  return detached;
}

export function renderSignatureFile(sig: DetachedRecordSignature): string {
  return `${JSON.stringify(sig, null, 2)}\n`;
}

/** keyId -> public key PEM, committed next to the record so an auditor gets both. */
export interface VerificationKeysFile {
  keys: Record<string, string>;
}

export function parseVerificationKeys(raw: string): VerificationKeysFile {
  const parsed = JSON.parse(raw) as Partial<VerificationKeysFile>;
  if (!parsed.keys || typeof parsed.keys !== 'object') {
    throw new Error('verification-keys.json must contain a "keys" object of keyId -> public key PEM');
  }
  return { keys: parsed.keys as Record<string, string> };
}

export function renderVerificationKeys(file: VerificationKeysFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
