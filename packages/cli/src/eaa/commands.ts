/**
 * `legalithm eaa` — put a scanner's output on the EAA record, from CI.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS A CLIENT, NOT A STORE, AND THAT IS THE OPPOSITE OF `cra`.
 *
 * The CRA CLI keeps an append-only record on this machine because the join of
 * your SBOM against vulnerability data is a map of how to attack your product
 * and must never leave it. Nothing about the EAA is like that. A contrast
 * failure on a public checkout page is not a secret, and the EAA record already
 * lives in the tenant's database where the advisor, the statement generator and
 * the clock can all read it. A second local store would give one directive two
 * answers about whether a requirement is met.
 *
 * So these commands hold no state. They read a file your pipeline already
 * produced, post it, and print what the server did with it.
 *
 * A MACHINE WRITES HYPOTHESES. There is deliberately no `--declare`, no
 * `--met`, and no way to sign anything here. The ingest endpoint accepts
 * `not_met` observations and nothing else, and a conformance claim needs a
 * named human on a different endpoint. A CI job that could assert conformance
 * would be the whole product's failure, written as a convenience flag.
 *
 * IT CONSUMES SOMEBODY ELSE'S SCANNER ON PURPOSE. No browser is bundled and no
 * scan is run. Whatever you already use in CI — axe, or any tool that emits
 * EARL — produces the JSON, and this hands it over. That is what makes this an
 * evidence layer rather than a competing scanner.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { CliHttpError, getJson, postJson } from '../http.js';

export interface EaaIo {
  cwd: string;
  log: (message: string) => void;
  error: (message: string) => void;
}

/** Exit codes, so a pipeline can branch without parsing prose. */
export const EXIT = {
  ok: 0,
  /** The scan produced findings and the caller asked to fail on them. */
  findings: 1,
  /** Bad usage: a missing file, an unknown adapter, a refused payload. */
  usage: 2,
  /** The API could not be reached or rejected the call. */
  transport: 3,
} as const;

/** Adapters the server has a contract for. Refused here so a typo costs no round trip. */
export const ADAPTERS = ['axe-core', 'earl', 'user-testing'] as const;
export type EaaAdapter = (typeof ADAPTERS)[number];

export interface IngestOptions {
  subjectId: string;
  adapter: string;
  from: string;
  toolVersion?: string;
  subjectVersionLabel?: string;
  surfaceTarget?: string;
  observedAt?: string;
  apiUrl: string;
  apiKey: string;
  dryRun?: boolean;
  json?: boolean;
  /** Exit 1 when the run wrote any hypothesis. For a pipeline that should stop. */
  failOnFinding?: boolean;
}

interface IngestResponse {
  ok: true;
  runId: string;
  subjectVersion: string;
  tool: string;
  contractVersion: string;
  written: { hypotheses: number };
  obligationsTouched: string[];
  suppressed: { ruleId: string; obligationRef: string | null; kind: string; reason: string }[];
  notes: string[];
}

/** axe-core writes its own version into the report; other tools may not. */
function toolVersionFrom(payload: unknown, given?: string): string | null {
  if (given) return given;
  const p = payload as { testEngine?: { version?: unknown } } | null;
  const v = p?.testEngine?.version;
  return typeof v === 'string' ? v : null;
}

export async function eaaIngest(io: EaaIo, opts: IngestOptions): Promise<number> {
  if (!(ADAPTERS as readonly string[]).includes(opts.adapter)) {
    io.error(
      `Unknown adapter "${opts.adapter}". Available: ${ADAPTERS.join(', ')}. ` +
        'An adapter is a parser written against one tool\'s output shape, so there is no generic one.',
    );
    return EXIT.usage;
  }

  const path = isAbsolute(opts.from) ? opts.from : join(io.cwd, opts.from);
  if (!existsSync(path)) {
    io.error(`No such file: ${path}`);
    return EXIT.usage;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    io.error(`${path} is not valid JSON. Pass the tool's JSON reporter output, not its console output.`);
    return EXIT.usage;
  }

  const toolVersion = toolVersionFrom(payload, opts.toolVersion);
  if (!toolVersion) {
    // The version gate is what stops a silent mis-parse, so guessing one here
    // would disable the protection it exists to provide.
    io.error(
      'Could not read the tool version from the report, and none was given. ' +
        'Pass --tool-version <x.y.z>: the server refuses a payload it cannot version-check, ' +
        'because a mis-parsed report produces confident, wrong evidence.',
    );
    return EXIT.usage;
  }

  const body = {
    subjectId: opts.subjectId,
    packKey: 'eu-eaa',
    adapter: opts.adapter,
    toolVersion,
    payload,
    ...(opts.subjectVersionLabel ? { subjectVersionLabel: opts.subjectVersionLabel } : {}),
    ...(opts.surfaceTarget ? { surfaceTarget: opts.surfaceTarget } : {}),
    ...(opts.observedAt ? { observedAt: opts.observedAt } : {}),
  };

  if (opts.dryRun) {
    io.log(
      opts.json
        ? JSON.stringify({ wouldPost: { ...body, payload: `<${path}>` } }, null, 2)
        : [
            'Dry run. Nothing was sent.',
            `  subject      ${opts.subjectId}`,
            `  adapter      ${opts.adapter} @ ${toolVersion}`,
            `  payload      ${path}`,
            opts.subjectVersionLabel ? `  version      ${opts.subjectVersionLabel}` : '  version      (newest on record)',
            opts.surfaceTarget ? `  surface      ${opts.surfaceTarget}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
    );
    return EXIT.ok;
  }

  let res: IngestResponse;
  try {
    res = await postJson<IngestResponse>(
      `${opts.apiUrl}/api/v1/partner/record/ingest`,
      body,
      opts.apiKey,
    );
  } catch (error) {
    return reportHttpError(io, error);
  }

  if (opts.json) {
    io.log(JSON.stringify(res, null, 2));
  } else {
    io.log(`Ingested ${res.tool} into ${res.subjectVersion} (run ${res.runId}).`);
    io.log(`  hypotheses written  ${res.written.hypotheses}`);
    io.log(`  obligations touched ${res.obligationsTouched.length ? res.obligationsTouched.join(', ') : 'none'}`);
    if (res.suppressed.length > 0) {
      // "Zero hypotheses" and "nothing ran" look identical without this.
      io.log(`  looked at, not evidence: ${res.suppressed.length}`);
      for (const s of res.suppressed.slice(0, 5)) {
        io.log(`    ${s.ruleId} — ${s.kind}: ${s.reason}`);
      }
      if (res.suppressed.length > 5) io.log(`    and ${res.suppressed.length - 5} more`);
    }
    for (const n of res.notes) io.log(`  note: ${n}`);
    io.log('');
    io.log('These are hypotheses. Nothing here asserts conformance, and a clean run asserts nothing at all.');
  }

  return opts.failOnFinding && res.written.hypotheses > 0 ? EXIT.findings : EXIT.ok;
}

export interface ClockOptions {
  subjectId: string;
  apiUrl: string;
  apiKey: string;
  json?: boolean;
  /** Exit 1 when a dated duty has lapsed. The gate worth putting in a pipeline. */
  failOnLapsed?: boolean;
}

interface ClockResponse {
  ok: true;
  worst: string;
  summary: Record<string, number>;
  deadlines: { kind: string; dueOn: string; status: string; daysRemaining: number; basis: string }[];
  notes: string[];
}

/**
 * `eaa clock` — what has gone stale, and what is about to lapse.
 *
 * The EAA-specific CI check nobody else has. A five-year Article 14 renewal
 * lapses silently: no build breaks, no scan fails, and the operator keeps
 * relying on an exemption they no longer hold. `--fail-on-lapsed` turns that
 * into a red pipeline on the day it happens.
 */
export async function eaaClock(io: EaaIo, opts: ClockOptions): Promise<number> {
  let res: ClockResponse;
  try {
    res = await getJson<ClockResponse>(
      `${opts.apiUrl}/api/v1/partner/record/clock?subjectId=${encodeURIComponent(opts.subjectId)}`,
      opts.apiKey,
    );
  } catch (error) {
    return reportHttpError(io, error);
  }

  if (opts.json) {
    io.log(JSON.stringify(res, null, 2));
  } else {
    io.log(`Freshness: ${res.worst}`);
    for (const [k, v] of Object.entries(res.summary)) {
      if (v > 0) io.log(`  ${k.padEnd(10)} ${v}`);
    }
    if (res.deadlines.length === 0) {
      io.log('  no dated duties on record');
    } else {
      for (const d of res.deadlines) {
        const when =
          d.status === 'lapsed'
            ? `LAPSED ${Math.abs(d.daysRemaining)} days ago`
            : `${d.daysRemaining} days left`;
        io.log(`  ${d.kind.padEnd(16)} ${d.dueOn}  ${when}`);
        if (d.status === 'lapsed') io.log(`    ${d.basis}`);
      }
    }
    for (const n of res.notes) io.log(`  note: ${n}`);
  }

  const lapsed = res.deadlines.filter((d) => d.status === 'lapsed').length;
  return opts.failOnLapsed && lapsed > 0 ? EXIT.findings : EXIT.ok;
}

/** Print the server's reason rather than its status code. */
function reportHttpError(io: EaaIo, error: unknown): number {
  if (!(error instanceof CliHttpError)) {
    io.error(error instanceof Error ? error.message : 'Unknown error');
    return EXIT.transport;
  }
  const body = error.body as
    | { error?: string; reason?: string; detail?: string; gate?: string }
    | undefined;
  io.error(body?.error ?? error.message);
  if (body?.gate) io.error(`  gate:   ${body.gate}`);
  if (body?.reason) io.error(`  reason: ${body.reason}`);
  if (body?.detail) io.error(`  detail: ${body.detail}`);
  return EXIT.transport;
}
