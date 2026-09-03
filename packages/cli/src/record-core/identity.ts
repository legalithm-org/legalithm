// GENERATED FILE, DO NOT EDIT.
// Vendored from packages/record-core/src by scripts/generate-cli-record-core.ts.
// Edit the source there and re-run: npx tsx scripts/generate-cli-record-core.ts
// A drift test fails if this copy and the source disagree.
/**
 * TWO hash functions, and which is which matters.
 *
 * They look alike and do different jobs, and the distinction was undocumented
 * in the code this replaces, which is exactly how someone later "simplifies"
 * them into one and silently breaks every record.
 *
 *   contentId   IDENTITY. Hashes everything it is given. Two assertions are
 *               the same assertion when they hash the same, so nothing that
 *               moves on its own may go in.
 *
 *   recordHash  SNAPSHOT INTEGRITY. Excludes the volatile stamps below, so
 *               regenerating the same record tomorrow is not read as drift.
 *               A record whose hash changes daily proves nothing.
 *
 * Put `generatedAt` into contentId and re-running a CI step appends the same
 * SBOM again on every run, which defeats content addressing entirely. That is
 * not hypothetical: it shipped in the CRA store and had to be fixed.
 *
 * IDS CARRY THE FULL DIGEST BEHIND A READABLE PREFIX.
 *
 * The prefix is worth keeping: `clm_9f2c...` in a log tells you what you are
 * looking at, and `9f2c...` does not. The truncation that came with it is not:
 * one side stored 12 hex characters, 48 bits, as the primary key of a record
 * retained for ten years. The two are separable, so this takes the prefix and
 * drops the truncation.
 */
import { contentHash } from './canonical.js';

/**
 * Fields excluded from `recordHash`. They move without the record changing.
 */
const VOLATILE = new Set(['generatedAt', 'asOf', 'generatedBy', 'computedAt', 'recordedAt']);

export function recordHash(snapshot: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snapshot)) if (!VOLATILE.has(k)) body[k] = v;
  return contentHash(body);
}

/** Row kinds that get a content-addressed id. */
export type IdKind = 'hyp' | 'clm' | 'cfl' | 'evt';

/**
 * The preimage, stated once so both sides can never disagree about it.
 *
 * `kind` is inside the hash, not just the prefix, so the same body filed as a
 * hypothesis and as a claim cannot collide. That boundary is the point of the
 * whole architecture and it would be careless to leave it to a string prefix.
 *
 * `observedAt` is part of identity ONLY when the caller supplied it. A
 * defaulted observedAt is just "now", and folding "now" into identity makes
 * every re-run a new row. An EXPLICIT observedAt is a different fact, because
 * back-dating something you learned late is a different assertion.
 */
export function contentId(
  kind: IdKind,
  body: unknown,
  observedAt?: string | null,
): string {
  return `${kind}_${contentHash({ kind, body, observedAt: observedAt ?? null })}`;
}

export const hypothesisId = (body: unknown, observedAt?: string | null) => contentId('hyp', body, observedAt);
export const claimId = (body: unknown, observedAt?: string | null) => contentId('clm', body, observedAt);
export const conflictId = (body: unknown) => contentId('cfl', body);

/** True for an id this module would mint. Used to reject storage-assigned ids. */
export function isContentId(id: string): boolean {
  return /^(hyp|clm|cfl|evt)_[0-9a-f]{64}$/.test(id);
}
