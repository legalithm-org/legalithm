// GENERATED FILE, DO NOT EDIT.
// Vendored from packages/record-core/src by scripts/generate-cli-record-core.ts.
// Edit the source there and re-run: npx tsx scripts/generate-cli-record-core.ts
// A drift test fails if this copy and the source disagree.
/**
 * The canonicaliser, with no Node imports, so a browser can use the SAME one.
 *
 * Split out of `canonical.ts` when the CRA record viewer needed to recompute a
 * record hash client-side. The alternative was a second canonicaliser written
 * for the browser, which is precisely what `canonical.ts` exists to prevent:
 * that file's own header documents four implementations being consolidated into
 * one after they were found to disagree on Dates.
 *
 * A verifier that canonicalises differently from the writer does not verify
 * anything. It checks its own arithmetic.
 *
 * `canonical.ts` still owns hashing, because SHA-256 comes from `node:crypto`
 * there and from WebCrypto in a browser, and only the hashing differs.
 */

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Stable JSON with sorted keys. Safe to hash, safe to diff. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
