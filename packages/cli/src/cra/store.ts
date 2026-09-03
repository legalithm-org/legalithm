/**
 * The CRA evidence store: append-only, bitemporal, content-addressed, on disk.
 *
 * Three properties, each of which exists for a reason that shows up in an audit
 * rather than in a demo.
 *
 * APPEND-ONLY. Nothing is ever updated in place. A changed determination is a
 * new event that supersedes the old one, and both stay readable. Article 31
 * requires the technical documentation kept for 10 years after placing on the
 * market or the support period, whichever is longer; a store that overwrites
 * cannot answer a question about 2027 when asked in 2035.
 *
 * BITEMPORAL. Every event carries `observedAt` (when the fact was true) and
 * `recordedAt` (when we learned it). A market surveillance authority does not
 * ask whether a vulnerability was exploitable. It asks what you knew on a given
 * date and what you did about it, and only two clocks can answer that.
 *
 * CONTENT-ADDRESSED. The id is sha256 over the canonical body, so re-ingesting
 * the same evidence is idempotent and the file can be restored elsewhere and
 * still verify. Storage-assigned ids leak into snapshots and make identical
 * evidence hash differently on every run.
 *
 * JSONL because it is greppable, diffable, appendable without a parse, and
 * survives this tool being uninstalled. The customer keeps their evidence.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contentId, type IdKind } from '../record-core/index.js';

export const CRA_DIR = join('compliance', 'cra');

/**
 * Streams are separate FILES, not a `kind` column, because the boundary between
 * a machine's guess and a human's assertion has to be impossible to cross by
 * accident. A bug in a status field can promote a hypothesis to a claim; a
 * bug cannot write to a different file by mistake.
 */
export type Stream =
  | 'products'
  | 'evidence'
  | 'hypotheses'
  | 'claims'
  | 'clocks'
  | 'classification'
  | 'policy'
  | 'assessments'
  | 'support'
  | 'advisories'
  | 'requests'
  | 'risk';

export interface StoreEvent<T = Record<string, unknown>> {
  /** sha256 of the canonical body. */
  id: string;
  /** When the fact was true. */
  observedAt: string;
  /** When we learned it. */
  recordedAt: string;
  /** Event this one supersedes, if any. Nothing is deleted. */
  supersedes?: string;
  body: T;
}

function streamPath(cwd: string, stream: Stream): string {
  return join(cwd, CRA_DIR, `${stream}.jsonl`);
}

/**
 * Identity comes from packages/record-core, shared verbatim with the server.
 *
 * This file used to carry its own canonicaliser. It agreed with the other three
 * in the codebase on every input tested except one: a Date canonicalised to
 * `{}`, so every distinct timestamp hashed the same. Latent here, because every
 * caller passed ISO strings, and removed rather than left to be discovered.
 */
export { canonicalJson as canonical, contentHash } from '../record-core/index.js';

/**
 * Streams map onto the shared id kinds so the hypothesis/claim boundary is
 * visible in the id itself, and `stream` stays inside the preimage so two
 * different streams holding an identical body can never collide.
 */
function kindOf(stream: Stream): IdKind {
  if (stream === 'hypotheses') return 'hyp';
  if (stream === 'claims') return 'clm';
  return 'evt';
}

export function readStream<T = Record<string, unknown>>(
  cwd: string,
  stream: Stream,
): StoreEvent<T>[] {
  const path = streamPath(cwd, stream);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as StoreEvent<T>);
}

export interface AppendOptions {
  /** Defaults to now. Supply it when back-dating a fact you learned late. */
  observedAt?: string;
  supersedes?: string;
  /** Injected so tests are not timing-dependent. */
  now?: () => Date;
}

/**
 * Append an event. Returns the stored event and whether it was new: an
 * identical body at the same observedAt is a no-op, so re-running a CI step
 * does not grow the log.
 */
export function append<T extends Record<string, unknown>>(
  cwd: string,
  stream: Stream,
  body: T,
  options: AppendOptions = {},
): { event: StoreEvent<T>; created: boolean } {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const observedAt = options.observedAt ?? now;
  // Identity is the ASSERTION, not the moment it was written. Folding a
  // defaulted `observedAt` (which is just "now") into the id made re-running
  // the same CI step append the same SBOM again on every run, which defeats
  // the content-addressing entirely. An EXPLICIT observedAt is part of
  // identity, because back-dating a fact you learned late is a different fact.
  const id = contentId(kindOf(stream), { stream, body }, options.observedAt ?? null);

  const existing = readStream<T>(cwd, stream).find((e) => e.id === id);
  if (existing) return { event: existing, created: false };

  const event: StoreEvent<T> = {
    id,
    observedAt,
    recordedAt: now,
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
    body,
  };
  const path = streamPath(cwd, stream);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
  return { event, created: true };
}

/**
 * What the store knew at a given decision time, with superseded events removed.
 *
 * This is the query an auditor actually makes. Passing no date answers "now",
 * which is the only view most tools can produce at all.
 */
export function asOf<T>(events: StoreEvent<T>[], decisionTime?: string): StoreEvent<T>[] {
  const cutoff = decisionTime ?? new Date().toISOString();
  const known = events.filter((e) => e.recordedAt <= cutoff);
  const superseded = new Set(known.map((e) => e.supersedes).filter(Boolean) as string[]);
  return known.filter((e) => !superseded.has(e.id));
}

export function storeExists(cwd: string): boolean {
  return existsSync(join(cwd, CRA_DIR));
}
