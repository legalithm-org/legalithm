// GENERATED FILE, DO NOT EDIT.
// Vendored from packages/record-core/src by scripts/generate-cli-record-core.ts.
// Edit the source there and re-run: npx tsx scripts/generate-cli-record-core.ts
// A drift test fails if this copy and the source disagree.
/**
 * ONE canonicaliser. This file is the reason the package exists.
 *
 * Before this there were four, in lib/ai_act/record/canonical.ts,
 * packages/cli/src/record-hash.ts, lib/record/identity.ts and
 * packages/cli/src/cra/store.ts. Two of them were the same primitive
 * deliberately duplicated across the local/hosted boundary and kept in sync by
 * hand; the other two were written independently for the same job.
 *
 * They were compared empirically before this file was written, across key
 * reordering, nested objects, arrays, nulls, undefined-valued keys and Dates.
 * EVERY case agreed except one:
 *
 *     canonical({ d: new Date(...) })
 *       three implementations -> {"d":{}}
 *       one implementation    -> {"d":"2026-01-01T00:00:00.000Z"}
 *
 * `Object.entries(someDate)` is `[]`, so a Date falls into the object branch and
 * canonicalises to `{}`. Every distinct timestamp then hashes identically. It
 * was latent rather than live, because every caller happened to pass ISO
 * strings, and the AI Act generator explicitly forbids `new Date()` inside it.
 * Latent is not fixed: it is a collision waiting for the first caller who
 * passes a Date, in a store whose whole purpose is telling two dated
 * assertions apart.
 *
 * So the guard is here, and it is the ONLY behavioural change this
 * consolidation makes. Records already issued hash to exactly what they hashed
 * to before, which is checked by a compatibility test rather than assumed.
 *
 * ARRAYS KEEP THEIR ORDER. Only object keys are sorted. A list of components in
 * an SBOM is not the same list reordered, and sorting it would erase a real
 * difference.
 */
import { createHash } from 'node:crypto';

/*
 * The canonicaliser itself lives in `canonical-core.ts`, which imports nothing,
 * so the browser-side record viewer uses this exact code rather than a second
 * implementation written to match it. Only the hashing differs between the two
 * environments: `node:crypto` here, WebCrypto there.
 */
export { canonicalize, canonicalJson } from './canonical-core.js';
import { canonicalJson } from './canonical-core.js';

/** sha256 hex of the canonical JSON. The full digest, never truncated. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * A 12-hex prefix, for logs and human-facing engine versions ONLY.
 *
 * Never use this as a stored identifier. 48 bits is fine for reading a line of
 * output and far too little for a key in a store that has to stay unambiguous
 * for the ten years Article 31 requires the technical documentation kept.
 */
export function shortHash(value: unknown): string {
  return contentHash(value).slice(0, 12);
}
