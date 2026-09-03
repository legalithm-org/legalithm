// GENERATED FILE, DO NOT EDIT.
// Vendored from packages/record-core/src by scripts/generate-cli-record-core.ts.
// Edit the source there and re-run: npx tsx scripts/generate-cli-record-core.ts
// A drift test fails if this copy and the source disagree.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

import { verifyChain, type RecordVersion, type SignatureState } from './chain.js';

/**
 * Offline verification of a signed record, by a third party with no account and
 * no call to Legalithm.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT CRYPTOGRAPHICALLY GUARANTEED, STATED PLAINLY.
 *
 * SOUND offline, needing nothing but this code and the bundle:
 *   - tamper:  every RecordVersion.sha recomputes from its snapshot and the
 *              prevSha chain links, so any edit to the recorded facts breaks it.
 *   - signer:  the detached signature verifies against the signed version's sha
 *              with the public key carried in the bundle, so the holder of that
 *              key stood behind exactly these facts.
 *   - what was decided against:  the pinned corpus hashes travel in the signed
 *              snapshot, so the obligation versions cannot be changed after the
 *              fact without breaking the sha.
 *
 * NOT bound to the signature, and therefore only as trustworthy as Legalithm's
 * own copy:
 *   - the AUTHORITY (on whose behalf, under which partner). The client holds the
 *     only key and signs the record sha; the authority is a fact Legalithm
 *     derives at signing time and stores beside the signature. Binding it into
 *     the signed bytes would require Legalithm to hold a key and countersign,
 *     which the architecture deliberately refuses. So offline we can prove an
 *     advisor signature HAS authority recorded, and report it, but we cannot
 *     prove the recorded authority was genuine without trusting the issuer.
 *
 * A verifier that overstated the second point would be doing the exact thing
 * this product sells against, so the verdict keeps the two apart.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A detached signature over a record version's sha, as it travels in a bundle. */
export interface BundleSignature {
  keyId: string;
  publicKeyPem: string;
  signature: string;
  signerRole: string;
  /** Recorded by the issuer at signing time. Not covered by the signature. */
  authority?: {
    partnerId: string | null;
    onBehalfOfTenantId: string | null;
    snapshot: Record<string, unknown> | null;
  } | null;
}

/** The self-contained artifact a signer hands out. Verifiable with only this file. */
export interface RecordBundle {
  format: 'legalithm.record-bundle';
  version: 1;
  subject: { name: string };
  /** The full chain up to and including the signed version, so tamper is checkable. */
  chain: RecordVersion[];
  /** Which version the signatures below cover (its n). */
  signedVersion: number;
  signatures: BundleSignature[];
}

export interface SignatureVerdict {
  keyId: string;
  signerRole: string;
  /** The signature verifies against the signed version's sha with its public key. */
  valid: boolean;
  /**
   * For an advisor signature: authority was recorded. Sound offline. Absence is
   * a fail, matching the rule the server enforces at signing time.
   */
  authorityRecorded: boolean;
  /**
   * The recorded authority, surfaced for a reader. NOT cryptographically bound
   * to the signature, so it is an issuer attestation, not proof.
   */
  authority: BundleSignature['authority'];
}

export interface RecordVerdict {
  /** Overall: the record is authentic AND at least one signature is valid. */
  ok: boolean;
  state: SignatureState;
  subjectName: string;
  signedVersion: number;
  /** Obligation versions the signed record was pinned to. Sound offline. */
  corpusHashes: Record<string, string>;
  signatures: SignatureVerdict[];
  /** Why it failed, when it did. */
  reason?: string;
}

const isBundle = (b: unknown): b is RecordBundle =>
  !!b &&
  typeof b === 'object' &&
  (b as RecordBundle).format === 'legalithm.record-bundle' &&
  Array.isArray((b as RecordBundle).chain) &&
  Array.isArray((b as RecordBundle).signatures);

/** Verify one detached signature over a sha. Pure node:crypto; no key registry. */
export function verifyBundleSignature(sha: string, sig: BundleSignature): boolean {
  try {
    const key = createPublicKey(sig.publicKeyPem);
    // null algorithm: Ed25519 carries its own hash, and Node infers for RSA/ECDSA,
    // so the caller never names an algorithm we would then have to trust. This
    // matches lib/record/signature.ts and the CLI verifier exactly.
    return cryptoVerify(null, Buffer.from(sha, 'utf8'), key, Buffer.from(sig.signature, 'base64'));
  } catch {
    // A malformed key or signature is an invalid signature, not an exception.
    return false;
  }
}

/**
 * Verify a whole bundle offline. Returns a verdict; never throws on bad input,
 * because a third party feeding it an arbitrary file must get a clear "no", not
 * a stack trace.
 */
export function verifyRecordBundle(input: unknown): RecordVerdict {
  const empty: RecordVerdict = {
    ok: false,
    state: 'tampered',
    subjectName: '',
    signedVersion: 0,
    corpusHashes: {},
    signatures: [],
  };

  if (!isBundle(input)) {
    return { ...empty, reason: 'not a Legalithm record bundle' };
  }
  const bundle = input;

  // 1. Tamper. The chain must recompute end to end.
  const chainVerdict = verifyChain(bundle.chain);
  if (!chainVerdict.ok) {
    return {
      ...empty,
      subjectName: bundle.subject?.name ?? '',
      signedVersion: bundle.signedVersion,
      reason: `record altered: ${chainVerdict.reason} at version ${chainVerdict.at}`,
    };
  }

  const signed = bundle.chain.find((v) => v.n === bundle.signedVersion);
  if (!signed) {
    return {
      ...empty,
      subjectName: bundle.subject?.name ?? '',
      signedVersion: bundle.signedVersion,
      reason: `bundle names signed version ${bundle.signedVersion} but the chain does not contain it`,
    };
  }

  // 2 & 3. Attribution, and the advisor-authority rule, per signature.
  const signatures: SignatureVerdict[] = bundle.signatures.map((sig) => {
    const valid = verifyBundleSignature(signed.sha, sig);
    const authorityRecorded = !!(sig.authority && sig.authority.partnerId);
    return {
      keyId: sig.keyId,
      signerRole: sig.signerRole,
      valid,
      authorityRecorded,
      authority: sig.authority ?? null,
    };
  });

  // An advisor signature with no recorded authority is not a valid delegated
  // signature, the same rule the server enforces when the signature is made.
  const soundlySigned = signatures.filter(
    (s) => s.valid && (s.signerRole !== 'advisor' || s.authorityRecorded),
  );

  const anyValid = signatures.some((s) => s.valid);
  const advisorWithoutAuthority = signatures.some(
    (s) => s.valid && s.signerRole === 'advisor' && !s.authorityRecorded,
  );

  let state: SignatureState = 'unsigned';
  let reason: string | undefined;
  if (signatures.length === 0) {
    state = 'unsigned';
    reason = 'the record is authentic but carries no signature';
  } else if (soundlySigned.length > 0) {
    state = 'signed';
  } else if (advisorWithoutAuthority) {
    state = 'signature_invalid';
    reason = 'an advisor signed without recorded delegated authority';
  } else if (!anyValid) {
    state = 'signature_invalid';
    reason = 'the signature does not verify against the record';
  }

  return {
    ok: soundlySigned.length > 0,
    state,
    subjectName: bundle.subject.name,
    signedVersion: bundle.signedVersion,
    corpusHashes: signed.packCorpusHashes ?? {},
    signatures,
    reason,
  };
}
