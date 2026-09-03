/**
 * Supplier attestations. Decision 9, and the shape it insists on:
 *
 *   "Supplier network is manufacturer-pays, and a supplier's response is a
 *    signed reusable claim the supplier owns, not a form submission into a
 *    customer tenant."
 *
 * Three words in that sentence do all the work.
 *
 * REUSABLE. An attestation answers a question about a component, not about a
 * customer. It therefore names no requester, and `attestationBody` has no field
 * that could hold one. A supplier answers "is lodash 4.17.20 affected by
 * CVE-2021-23337" once and hands the same signed file to every manufacturer who
 * asks. If the artifact carried the requester, it would be a form submission
 * wearing a signature, and the supplier would be doing the same work per
 * customer forever.
 *
 * OWNS. The supplier signs with their own key and keeps the file. There is no
 * tenant to submit into, no account to create, and nothing of ours between the
 * two parties: a manufacturer receives a file by whatever channel they already
 * use, and can verify it offline. That is also why this is a set of file
 * commands rather than a service. A "supplier network" with a server in the
 * middle would put us in the trust path, which is the thing the customer-held
 * key exists to avoid.
 *
 * MANUFACTURER-PAYS falls out of that rather than being enforced in code. The
 * supplier's cost is signing one file; nobody has to buy anything to answer.
 *
 * WHAT AN ATTESTATION IS NOT: it is not the manufacturer's claim. Ingesting one
 * writes EVIDENCE with `sourceType: 'attestation'`, and a named human at the
 * manufacturer still has to make their own determination. A supplier saying
 * "not affected" is a fact about what the supplier said, and laundering it
 * straight into your own conformity position is exactly the move the
 * hypothesis/claim boundary exists to prevent. The supplier does not carry your
 * Article 13 obligations, and cannot be made to by a file.
 */

import { createHash } from 'node:crypto';

import { canonicalize } from '../record-core/canonical.js';
import type { DetachedRecordSignature } from '../record-signature.js';

export const REQUEST_SCHEMA = 'legalithm.cra.attestation-request/v0.1';
export const ATTESTATION_SCHEMA = 'legalithm.cra.attestation/v0.1';

/** The verdicts a supplier can return. Same vocabulary as a claim. */
export type AttestationVerdict = 'not_affected' | 'affected' | 'fixed';

export const ATTESTATION_VERDICTS: readonly AttestationVerdict[] = [
  'not_affected',
  'affected',
  'fixed',
];

/**
 * A question. Not signed: it is a request, not an assertion, and signing it
 * would imply the asker is vouching for something.
 *
 * `requestedBy` exists so a supplier knows who is asking and can decline. It is
 * deliberately NOT carried into the attestation.
 */
export interface AttestationRequest {
  schema: typeof REQUEST_SCHEMA;
  component: string;
  componentVersion: string;
  cve: string;
  requestedBy: string;
  requestedAt: string;
}

/** The part of an attestation that is hashed and signed. */
export interface AttestationBody {
  schema: typeof ATTESTATION_SCHEMA;
  component: string;
  componentVersion: string;
  cve: string;
  verdict: AttestationVerdict;
  /** Why. A verdict without reasoning is not evidence, for a supplier either. */
  rationale: string;
  /** The person. Not a team, not a role, not a company alone. */
  declaredBy: string;
  /** The company they answer for. */
  organisation: string;
  declaredAt: string;
}

/**
 * The file a supplier hands over: the signed body, its hash, the signature, and
 * the public key.
 *
 * The key travels WITH the attestation on purpose. A manufacturer who receives
 * one file should be able to check it immediately, without first negotiating a
 * key exchange. The cost is that an inline key proves possession and not
 * identity, which the verifier says out loud every time rather than letting
 * anyone assume otherwise.
 */
export interface SignedAttestation {
  body: AttestationBody;
  attestationHash: string;
  signature: DetachedRecordSignature;
  /** PEM of the public half, so the file verifies standalone. */
  publicKey: string;
}

/**
 * Hash over the canonical body. Same rule as the record: content only.
 *
 * `declaredAt` IS hashed here, unlike the record's `generatedAt`. A record is
 * regenerated from a store and must hash identically across runs; an
 * attestation is a one-off statement, and when the supplier made it is part of
 * what they are saying.
 */
export function attestationHash(body: AttestationBody): string {
  const canonical = JSON.stringify(canonicalize(body as unknown as Record<string, unknown>));
  return createHash('sha256').update(canonical).digest('hex');
}

/** Free-text identity for the evidence row, per the architecture's primitive. */
export function sourceIdentity(body: AttestationBody): string {
  return `${body.declaredBy} at ${body.organisation}`;
}

export function buildRequest(input: {
  component: string;
  componentVersion: string;
  cve: string;
  requestedBy: string;
  now: Date;
}): AttestationRequest {
  return {
    schema: REQUEST_SCHEMA,
    component: input.component,
    componentVersion: input.componentVersion,
    cve: input.cve.toUpperCase(),
    requestedBy: input.requestedBy,
    requestedAt: input.now.toISOString(),
  };
}

/**
 * Build the body a supplier signs.
 *
 * Takes the request only to copy the SUBJECT across. `requestedBy` is read and
 * discarded, which is the whole reusability property in one line: the answer is
 * about the component, so it is worth the same to the next manufacturer who
 * asks.
 */
export function buildAttestationBody(input: {
  request: AttestationRequest;
  verdict: AttestationVerdict;
  rationale: string;
  declaredBy: string;
  organisation: string;
  now: Date;
}): AttestationBody {
  return {
    schema: ATTESTATION_SCHEMA,
    component: input.request.component,
    componentVersion: input.request.componentVersion,
    cve: input.request.cve.toUpperCase(),
    verdict: input.verdict,
    rationale: input.rationale,
    declaredBy: input.declaredBy,
    organisation: input.organisation,
    declaredAt: input.now.toISOString(),
  };
}

export type AttestationCheck =
  | { ok: true; body: AttestationBody; keyId: string }
  | { ok: false; reason: string };

/**
 * Check an attestation from the file alone.
 *
 * Order matters. The hash is checked before the signature, so an altered
 * attestation is reported as altered rather than as "signed by someone".
 */
export function checkAttestation(
  parsed: unknown,
  verify: (hash: string, sig: DetachedRecordSignature, publicKeyPem: string) => boolean,
): AttestationCheck {
  const a = parsed as Partial<SignedAttestation>;
  if (!a || typeof a !== 'object' || !a.body || !a.signature || !a.attestationHash) {
    return { ok: false, reason: 'Not an attestation: expected body, attestationHash and signature.' };
  }
  if (a.body.schema !== ATTESTATION_SCHEMA) {
    return { ok: false, reason: `Unknown schema ${String(a.body.schema)}; this build reads ${ATTESTATION_SCHEMA}.` };
  }
  if (!a.publicKey) {
    return { ok: false, reason: 'No public key in the attestation, so nothing can verify it.' };
  }

  const recomputed = attestationHash(a.body);
  if (recomputed !== a.attestationHash) {
    return { ok: false, reason: 'Altered since it was signed: the content does not match its own hash.' };
  }
  if (!verify(a.attestationHash, a.signature, a.publicKey)) {
    return { ok: false, reason: `Signature does not verify under key "${a.signature.keyId}".` };
  }
  return { ok: true, body: a.body, keyId: a.signature.keyId };
}

// --------------------------------------------------------------- routing ---

/**
 * Where to send a request, derived from what is already on this machine.
 *
 * NO NETWORK, EVER. The obvious implementation asks a registry for each
 * component's metadata, and that would hand your entire dependency list to the
 * registry one lookup at a time. Decision 4 says the SBOM-to-vulnerability join
 * never leaves the customer; a routing lookup leaks exactly the same list, just
 * more slowly, and it would be a strange thing to be careful about OSV and
 * careless about here.
 *
 * Everything needed is already in the installed manifests: `repository`, `bugs`
 * and `author` are on disk because the package is on disk. Real values, sampled
 * from this repo's own tree:
 *
 *   semver       repo git+https://github.com/npm/node-semver.git   author GitHub Inc.
 *   node-fetch   bugs https://github.com/bitinn/node-fetch/issues
 *
 * The trade is that a component with no manifest on disk cannot be routed. That
 * is reported as a gap rather than guessed at, because a wrong address is worse
 * than a missing one: it looks like you asked.
 */
export interface SupplierContact {
  component: string;
  repository: string | null;
  issues: string | null;
  author: string | null;
  /** The best available destination, or null when there is none. */
  route: string | null;
  /** Present only when `route` is null: why this one cannot be routed. */
  gap?: string;
}

function pickUrl(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as { url?: unknown; email?: unknown };
    if (typeof o.url === 'string') return o.url;
    if (typeof o.email === 'string') return o.email;
  }
  return null;
}

/** Normalise the git URL forms npm manifests use into something a human can open. */
function tidyRepo(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

export function contactFromManifest(component: string, manifest: unknown): SupplierContact {
  const m = (manifest ?? {}) as Record<string, unknown>;
  const repository = tidyRepo(pickUrl(m.repository));
  const issues = pickUrl(m.bugs);
  const author = pickUrl(m.author) ?? (typeof m.author === 'string' ? m.author : null);

  // An issue tracker beats a repository: it is where a maintainer looks.
  const route = issues ?? repository ?? null;
  return {
    component,
    repository,
    issues,
    author,
    route,
    ...(route ? {} : { gap: 'no repository, issue tracker or author in the installed manifest' }),
  };
}

// ------------------------------------------------------ request tracking ---

export interface RequestBody extends Record<string, unknown> {
  component: string;
  componentVersion: string;
  cve: string;
  requestedBy: string;
}

/** One outstanding question is one (component, cve) pair. */
export function requestKey(component: string, cve: string): string {
  return `${component.toLowerCase()}@@${cve.toUpperCase()}`;
}

export interface RequestStatusRow {
  component: string;
  cve: string;
  requestedAt: string;
  answered: boolean;
  answeredBy?: string;
  /** Days outstanding, for the ones still open. */
  ageDays?: number;
}

/**
 * Join what was asked against what came back.
 *
 * Answered is keyed on (component, cve) rather than on the request, because an
 * attestation is reusable BY DESIGN: it names no requester, so it cannot point
 * back at the question that prompted it. That is the property working as
 * intended, not a gap in the data — a supplier's answer about a component
 * settles the question for anyone who asked it.
 */
export function summariseRequests(
  requests: { body: RequestBody; observedAt: string }[],
  answers: { component: string; cve: string; declaredBy: string }[],
  now: Date,
): RequestStatusRow[] {
  const answered = new Map<string, string>();
  for (const a of answers) answered.set(requestKey(a.component, a.cve), a.declaredBy);

  const latest = new Map<string, { body: RequestBody; observedAt: string }>();
  for (const r of requests) {
    const k = requestKey(r.body.component, r.body.cve);
    const prior = latest.get(k);
    if (!prior || r.observedAt < prior.observedAt) latest.set(k, r); // keep the FIRST ask
  }

  const rows: RequestStatusRow[] = [...latest.values()]
    .map((r): RequestStatusRow => {
      const who = answered.get(requestKey(r.body.component, r.body.cve));
      const ageDays = Math.floor((now.getTime() - new Date(r.observedAt).getTime()) / 86_400_000);
      return {
        component: r.body.component,
        cve: r.body.cve,
        requestedAt: r.observedAt,
        answered: who !== undefined,
        ...(who !== undefined ? { answeredBy: who } : { ageDays }),
      };
    });

  // Outstanding first, oldest first within that: the work list, in the order a
  // person would work it.
  return rows.sort(
    (a, b) => Number(a.answered) - Number(b.answered) || (b.ageDays ?? 0) - (a.ageDays ?? 0),
  );
}
