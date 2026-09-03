/**
 * What changed since you last looked.
 *
 * Every competitor sells "continuous monitoring", and the scheduling half of it
 * is the easy half: cron, launchd and a CI timer all already exist. The part
 * worth building is the DIFF, and this store answers it in a way a current-state
 * database cannot.
 *
 * The record is bitemporal. `asOf(events, t)` reconstructs what was known at
 * decision time `t`, so "what changed" is the same question the format was built
 * to answer, asked forward instead of backward. A competitor storing current
 * state has to keep a changelog and hope it was written correctly; here the
 * history IS the storage.
 *
 * Nothing here reaches the network. Monitoring runs where the join runs, which
 * is the customer's machine, and a scheduler the customer already has calls it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

import { asOf, readStream, type Stream, type StoreEvent } from './store.js';

export interface MonitorFinding {
  /** Machine-readable so a scheduler can branch on it. */
  kind:
    | 'hypothesis_new'
    | 'hypothesis_superseded'
    | 'claim_new'
    | 'determination_changed'
    | 'document_drifted'
    | 'support_expiring'
    | 'record_stale';
  detail: string;
  /** True when a person should look. Drives the exit code. */
  actionable: boolean;
}

export interface MonitorResult {
  since: string;
  until: string;
  findings: MonitorFinding[];
  /** Nothing changed and nothing is approaching. */
  quiet: boolean;
}

const WATCHED: Stream[] = ['hypotheses', 'claims', 'assessments', 'policy', 'risk', 'products', 'support'];

function idsAt<T>(events: StoreEvent<T>[], cutoff: string): Set<string> {
  return new Set(asOf(events, cutoff).map((e) => e.id));
}

/** Days between two ISO instants, rounded down. Negative when already past. */
export function daysUntil(iso: string, now: string): number {
  return Math.floor((Date.parse(iso) - Date.parse(now)) / 86_400_000);
}

export interface MonitorOptions {
  since?: string;
  now?: string;
  /** Warn this far ahead of the support period ending. */
  supportWarningDays?: number;
}

export function monitor(cwd: string, opts: MonitorOptions = {}): MonitorResult {
  const until = opts.now ?? new Date().toISOString();
  const warnDays = opts.supportWarningDays ?? 180;

  const streams = new Map<Stream, StoreEvent<Record<string, unknown>>[]>();
  for (const s of WATCHED) streams.set(s, readStream(cwd, s));

  /*
   * Default `since` is the last time the record was WRITTEN, not an arbitrary
   * window. The question a person actually has is "has anything moved since the
   * thing I signed", and answering a different question would be answering it
   * badly.
   */
  const recordPath = join(cwd, 'compliance', 'cra', 'record.json');
  let since = opts.since;
  if (!since && existsSync(recordPath)) {
    try {
      since = (JSON.parse(readFileSync(recordPath, 'utf8')) as { generatedAt?: string }).generatedAt;
    } catch {
      /* an unreadable record is reported below, not here */
    }
  }
  since = since ?? new Date(0).toISOString();

  const findings: MonitorFinding[] = [];

  for (const [name, events] of streams) {
    const before = idsAt(events, since);
    const now = asOf(events, until);
    const added = now.filter((e) => !before.has(e.id));

    for (const e of added) {
      const body = e.body as Record<string, unknown>;
      if (name === 'hypotheses') {
        findings.push({
          kind: 'hypothesis_new',
          detail: `${String(body.cve ?? 'a finding')} on ${String(body.component ?? 'a component')}`,
          actionable: true,
        });
      } else if (name === 'claims') {
        findings.push({
          kind: 'claim_new',
          detail: `${String(body.cve ?? '')} signed ${String(body.verdict ?? '')} by ${String(body.declaredBy ?? '')}`.trim(),
          actionable: false,
        });
      } else if (name === 'assessments') {
        findings.push({
          kind: 'determination_changed',
          detail: `${String(body.ref ?? '')} is now ${String(body.status ?? '')}`,
          actionable: false,
        });
      }
      // A superseding event means an earlier position was replaced.
      if (e.supersedes) {
        findings.push({
          kind: 'hypothesis_superseded',
          detail: `${name}: ${e.supersedes.slice(0, 12)} superseded`,
          actionable: false,
        });
      }
    }
  }

  /*
   * A pinned document that no longer matches its hash is the loudest thing this
   * can find: the record is signed over a hash, so the signature is intact and
   * the evidence underneath it has moved.
   */
  /*
   * ONLY THE NEWEST PIN PER DOCUMENT.
   *
   * The store is append-only, so re-pinning a document after editing it leaves
   * every earlier hash in place. The first version of this compared the file
   * against all of them and reported five drifts on a record that `cra record
   * --verify` passes: four superseded hashes, correctly computed, answering a
   * question nobody asked. A monitor that cries wolf is worse than no monitor,
   * because the response to it is to stop reading it.
   */
  const latest = new Map<string, { path: string; sha256: string; label: string }>();
  const collect = (stream: Stream, fallbackLabel: string) => {
    for (const row of asOf(streams.get(stream) ?? [], until)) {
      const b = row.body as Record<string, unknown>;
      if (typeof b.document !== 'string' || typeof b.documentHash !== 'string') continue;
      // Rows are appended in order, so the last write for a path wins.
      latest.set(b.document, {
        path: b.document,
        sha256: b.documentHash,
        label: String(b.kind ?? fallbackLabel),
      });
    }
  };
  collect('risk', 'risk assessment');
  collect('policy', 'document');
  const pinned = [...latest.values()];
  for (const doc of pinned) {
    const p = isAbsolute(doc.path) ? doc.path : join(cwd, doc.path);
    if (!existsSync(p)) continue; // absence is not drift; a record travels without its documents
    const actual = createHash('sha256').update(readFileSync(p)).digest('hex');
    if (actual !== doc.sha256) {
      findings.push({
        kind: 'document_drifted',
        detail: `${doc.path} (${doc.label}) no longer matches the hash the record pins`,
        actionable: true,
      });
    }
  }

  const support = asOf(streams.get('support') ?? [], until).at(-1);
  if (support) {
    const untilDate = String((support.body as Record<string, unknown>).until ?? '');
    const days = daysUntil(untilDate, until);
    if (days <= warnDays) {
      findings.push({
        kind: 'support_expiring',
        detail:
          days < 0
            ? `the support period ended ${Math.abs(days)} days ago (${untilDate}), and Article 13(8) obligations ran to that date`
            : `the support period ends in ${days} days (${untilDate})`,
        actionable: true,
      });
    }
  }

  /*
   * The record is a snapshot of a store that keeps moving. If the newest event
   * postdates the record, what was signed is no longer what is known, and that
   * is worth saying before anybody relies on it.
   */
  if (existsSync(recordPath)) {
    const newest = [...streams.values()]
      .flat()
      .map((e) => e.recordedAt)
      .sort()
      .at(-1);
    const generatedAt = (() => {
      try {
        return (JSON.parse(readFileSync(recordPath, 'utf8')) as { generatedAt?: string }).generatedAt;
      } catch {
        return undefined;
      }
    })();
    if (newest && generatedAt && newest > generatedAt) {
      findings.push({
        kind: 'record_stale',
        detail: `the store has moved since the record was generated (${generatedAt.slice(0, 10)}). Re-run \`cra record\` and sign it again`,
        actionable: true,
      });
    }
  } else {
    findings.push({
      kind: 'record_stale',
      detail: 'no record has been generated yet',
      actionable: true,
    });
  }

  return { since, until, findings, quiet: findings.length === 0 };
}

export interface MonitorIo {
  cwd: string;
  log: (m: string) => void;
}

/** Exit 0 when quiet, 3 when a person should look. Suitable for cron. */
export function craMonitor(io: MonitorIo, opts: MonitorOptions & { json?: boolean } = {}): number {
  const result = monitor(io.cwd, opts);

  if (opts.json) {
    io.log(JSON.stringify(result, null, 2));
    return result.findings.some((f) => f.actionable) ? 3 : 0;
  }

  io.log(`Changes since ${result.since.slice(0, 19).replace('T', ' ')}`);
  if (result.quiet) {
    io.log('  Nothing changed, nothing pinned has drifted, and the support period is not close.');
    io.log('');
    io.log('  Quiet is a finding too: it means the record still says what it said.');
    return 0;
  }

  const actionable = result.findings.filter((f) => f.actionable);
  const rest = result.findings.filter((f) => !f.actionable);

  if (actionable.length) {
    io.log('');
    io.log(`  ${actionable.length} thing(s) want a person:`);
    for (const f of actionable) io.log(`    ${f.kind.padEnd(22)} ${f.detail}`);
  }
  if (rest.length) {
    io.log('');
    io.log(`  ${rest.length} recorded, no action:`);
    for (const f of rest) io.log(`    ${f.kind.padEnd(22)} ${f.detail}`);
  }
  io.log('');
  io.log('  Nothing left this machine. Run this from cron, launchd or CI; the');
  io.log('  exit code is 3 when something wants a person and 0 when it does not.');

  return actionable.length ? 3 : 0;
}
