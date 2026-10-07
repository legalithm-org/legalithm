// GENERATED FILE, DO NOT EDIT.
// Vendored from packages/record-core/src by scripts/generate-cli-record-core.ts.
// Edit the source there and re-run: npx tsx scripts/generate-cli-record-core.ts
// A drift test fails if this copy and the source disagree.
/**
 * The type boundary, and the status derived across it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MACHINES WRITE HYPOTHESES. A NAMED HUMAN WRITES CLAIMS.
 *
 * These are separate tables, not two values of one status enum, and that is the
 * whole point. A status is bypassable by a bug in whatever derives it; a table
 * boundary is bypassable only by deliberately writing to the wrong table.
 *
 * No number of hypotheses ever produces a conforming status. A requirement with
 * fifty passing automated checks and no claim is `hypothesis_only`, and
 * `hypothesis_only` is not conformance.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is bitemporal. Rows carry `observedAt` (when the fact was
 * true) and `recordedAt` (when we learned it), so the store can answer the
 * question an authority actually asks: not "are you conformant" but "what did
 * you know on 14 March 2027, and what did you do about it".
 */

/** What a hypothesis or claim says about an obligation. */
export type Assertion = 'met' | 'not_met' | 'not_applicable';

/** How an observation was produced. */
export type Method = 'human_expert' | 'user_testing' | 'automated' | 'ai_assisted';

/**
 * How sure the source is, kept SEPARATE from how it was produced.
 *
 * Technical strength and legal strength are different axes, and these
 * regulations reward the legal one: a 0.87 fingerprint match is technically
 * stronger than a supplier's signed PDF and legally weaker, because the PDF
 * carries a name and a date.
 */
export type Confidence = 'exact' | 'fingerprint' | 'asserted';

export interface Hypothesis {
  id: string;
  subjectVersionId: string;
  surfaceId: string | null;
  packKey: string;
  obligationRef: string;
  assertion: Assertion;
  method: Method;
  sourceIdentity: string;
  confidence: Confidence;
  /** When the fact was true. */
  observedAt: string;
  /** When we learned it. */
  recordedAt: string;
  rawRef?: string | null;
  aiModel?: string | null;
  aiModelVersion?: string | null;
  aiPromptHash?: string | null;
  /** An expert row's argument. Part of its id when present. */
  rationale?: string | null;
  citations?: readonly string[];
}

export interface Claim {
  id: string;
  subjectVersionId: string;
  surfaceId: string | null;
  packKey: string;
  obligationRef: string;
  assertion: Assertion;
  /** The hypothesis a human promoted, where there was one. */
  fromHypothesisId?: string | null;
  /** A person. "The team" is not a declarant. */
  declaredBy: string;
  declaredAt: string;
  observedAt: string;
  recordedAt: string;
  signatureId?: string | null;
  rationale?: string | null;
}

export type ObligationStatus =
  | 'not_assessed'
  | 'hypothesis_only'
  | 'contested'
  | 'not_met'
  | 'not_applicable'
  | 'met';

export interface StatusResult {
  status: ObligationStatus;
  basis: string;
  claimIds: string[];
  hypothesisIds: string[];
  /** Set when a claim rests on a hypothesis that was not human or user-testing. */
  caveat: string | null;
}

const AUTOMATED_CAVEAT =
  'The promoted hypothesis was produced by automated or AI-assisted checking, which reliably ' +
  'covers a minority of the applicable criteria.';

/** Rows recorded at or before `asOf`. This is what makes the store bitemporal. */
export function knownAsOf<T extends { recordedAt: string }>(rows: T[], asOf?: string): T[] {
  if (!asOf) return rows;
  return rows.filter((r) => r.recordedAt <= asOf);
}

/**
 * Derive the status of one obligation on one subject version.
 *
 * `asOf` is a DECISION time, not a validity time: it answers "what did the
 * record say on that date", which is the question that matters in an audit.
 */
export function deriveStatus(
  claims: Claim[],
  hypotheses: Hypothesis[],
  asOf?: string,
): StatusResult {
  const c = knownAsOf(claims, asOf);
  const h = knownAsOf(hypotheses, asOf);
  const hypothesisIds = h.map((x) => x.id);

  if (c.length === 0) {
    return h.length === 0
      ? { status: 'not_assessed', basis: 'no claim and no hypothesis', claimIds: [], hypothesisIds, caveat: null }
      : {
          status: 'hypothesis_only',
          basis: `${h.length} ${h.length === 1 ? 'hypothesis' : 'hypotheses'}, no claim. A machine observation is not an assertion.`,
          claimIds: [],
          hypothesisIds,
          caveat: null,
        };
  }

  const claimIds = c.map((x) => x.id);
  const distinct = new Set(c.map((x) => x.assertion));

  // Conflicting claims are surfaced, never auto-resolved. The dated
  // disagreement is the interesting fact, and letting the last write win
  // destroys it.
  if (distinct.size > 1) {
    return {
      status: 'contested',
      basis: `claims disagree: ${[...distinct].sort().join(' vs ')}`,
      claimIds,
      hypothesisIds,
      caveat: null,
    };
  }

  const assertion = [...distinct][0]!;
  const promoted = c
    .map((x) => x.fromHypothesisId)
    .filter((id): id is string => Boolean(id))
    .map((id) => h.find((y) => y.id === id))
    .filter((x): x is Hypothesis => Boolean(x));
  const weak = assertion === 'met' && promoted.length > 0 &&
    promoted.every((p) => p.method === 'automated' || p.method === 'ai_assisted');

  return {
    status: assertion,
    basis: `claimed by ${[...new Set(c.map((x) => x.declaredBy))].join(', ')}`,
    claimIds,
    hypothesisIds,
    caveat: weak ? AUTOMATED_CAVEAT : null,
  };
}

export interface DetectedConflict {
  subjectVersionId: string;
  obligationRef: string;
  aId: string;
  bId: string;
  kind: 'claim_disagreement';
  detectedAt: string;
}

/**
 * Conflicting claims are a first-class object, not noise to resolve.
 *
 * The build says OpenSSL 3.0.11 and the supplier attested 3.0.9; axe says met
 * and the human tester says not met. That dated discrepancy is exactly what
 * market surveillance finds interesting, and no tool surfaces it because they
 * all let the last write win.
 */
export function detectConflicts(claims: Claim[], detectedAt: string): DetectedConflict[] {
  const groups = new Map<string, Claim[]>();
  for (const c of claims) {
    const key = `${c.subjectVersionId}::${c.obligationRef}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }

  const out: DetectedConflict[] = [];
  for (const [, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[i]!.assertion !== sorted[j]!.assertion) {
          out.push({
            subjectVersionId: sorted[i]!.subjectVersionId,
            obligationRef: sorted[i]!.obligationRef,
            aId: sorted[i]!.id,
            bId: sorted[j]!.id,
            kind: 'claim_disagreement',
            detectedAt,
          });
        }
      }
    }
  }
  return out;
}
