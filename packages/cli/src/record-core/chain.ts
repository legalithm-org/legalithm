// GENERATED FILE, DO NOT EDIT.
// Vendored from packages/record-core/src by scripts/generate-cli-record-core.ts.
// Edit the source there and re-run: npx tsx scripts/generate-cli-record-core.ts
// A drift test fails if this copy and the source disagree.
import { recordHash } from './identity.js';

/**
 * The append-only, hash-chained version log.
 *
 * Every version carries the hash of its predecessor, so the log is tamper
 * evident with NO private key anywhere — the way Certificate Transparency
 * works. That matters because it gives integrity and ordering to every record,
 * including the ones nobody ever signs, and it is what a vendor countersignature
 * would have bought without the key-custody liability that comes with one.
 *
 * Signing is separate and stays optional: the advisor signs, and Legalithm holds
 * no key.
 */

export interface RecordVersion {
  n: number;
  subjectId: string;
  sha: string;
  prevSha: string | null;
  snapshot: Record<string, unknown>;
  packCorpusHashes: Record<string, string>;
  asOf: string;
}

export interface AppendInput {
  subjectId: string;
  snapshot: Record<string, unknown>;
  packCorpusHashes: Record<string, string>;
  asOf: string;
}

/** Build the next version in a chain. Pure: callers persist the result. */
export function nextVersion(chain: RecordVersion[], input: AppendInput): RecordVersion {
  const prev = chain.length ? chain[chain.length - 1]! : null;
  const body = {
    subjectId: input.subjectId,
    prevSha: prev?.sha ?? null,
    packCorpusHashes: input.packCorpusHashes,
    ...input.snapshot,
  };
  return {
    n: (prev?.n ?? 0) + 1,
    subjectId: input.subjectId,
    sha: recordHash(body),
    prevSha: prev?.sha ?? null,
    snapshot: body,
    packCorpusHashes: input.packCorpusHashes,
    asOf: input.asOf,
  };
}

export type ChainVerdict =
  | { ok: true; length: number }
  | { ok: false; at: number; reason: 'snapshot hash mismatch' | 'broken prevSha link' | 'out of order' };

export function verifyChain(chain: RecordVersion[]): ChainVerdict {
  for (let i = 0; i < chain.length; i++) {
    const v = chain[i]!;
    if (v.n !== i + 1) return { ok: false, at: v.n, reason: 'out of order' };
    if (recordHash(v.snapshot) !== v.sha) return { ok: false, at: v.n, reason: 'snapshot hash mismatch' };
    const expectedPrev = i === 0 ? null : chain[i - 1]!.sha;
    if (v.prevSha !== expectedPrev) return { ok: false, at: v.n, reason: 'broken prevSha link' };
  }
  return { ok: true, length: chain.length };
}

/** Signature state is EXPLICIT. A hash match alone must never render as verified. */
export type SignatureState = 'unsigned' | 'signed' | 'signature_invalid' | 'tampered';
