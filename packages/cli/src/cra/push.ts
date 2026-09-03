/**
 * `cra push` — send the safe half of the record to the hosted control plane.
 *
 * Two things this command owes the person running it.
 *
 * The first is that it strips the sensitive half locally rather than relying on
 * the server to refuse it. The server refuses too, and that redundancy is the
 * point: either side alone is a single place for the promise to break.
 *
 * The second is that it SAYS what leaves. A command that quietly uploads part of
 * a compliance record has to be readable at a glance, or the local-first claim
 * is something a user takes on faith. So it prints the withheld categories by
 * name every time, and `--dry-run` prints the exact bytes without sending them.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PushPayload {
  product: { name: string; version: string; productClass: string; conformityRoute?: string };
  sourceRecordHash?: string;
  sourceSchema?: string;
  supportPeriod?: { until: string; declaredBy: string; rationale?: string } | null;
  determinations: {
    ref: string;
    status: string;
    declaredBy: string;
    declaredAt: string;
    rationale?: string;
    declaredForVersion?: string | null;
    staleForThisVersion?: boolean;
  }[];
  documents: {
    kind: string;
    path: string;
    sha256: string;
    summary: string;
    declaredBy: string;
    declaredAt: string;
  }[];
}

/** What is deliberately left behind, named so the output can list it. */
export const WITHHELD = [
  'machine hypotheses (component, version, CVE)',
  'signed claims',
  'evidence rows and the SBOM they came from',
  'Article 14 clocks, which name CVEs',
] as const;

interface RecordShape {
  schema?: string;
  recordHash?: string;
  products?: { name: string; version: string; productClass: string; route?: string }[];
  supportPeriod?: { until: string; declaredBy: string; rationale?: string } | null;
  riskAssessment?: {
    document: string;
    sha256: string;
    summary: string;
    declaredBy: string;
    declaredAt: string;
  } | null;
  documents?: {
    kind: string;
    document: string;
    sha256: string;
    summary: string;
    declaredBy: string;
    declaredAt: string;
  }[];
  annexI?: {
    determined?: {
      ref: string;
      status: string;
      declaredBy: string;
      declaredAt: string;
      rationale?: string;
      declaredForVersion?: string | null;
      staleForThisVersion?: boolean;
    }[];
  };
}

/**
 * Build the payload from a record.
 *
 * Only the newest product row is pushed. The snapshot is keyed on
 * (user, name, version) server-side, so pushing every historical version from
 * one record would create rows nobody asked for; run the command from each
 * version's own checkout if you want them all.
 */
export function buildPayload(record: RecordShape): PushPayload | { error: string } {
  const product = record.products?.[record.products.length - 1];
  if (!product) return { error: 'No product in this record. Run `legalithm cra product` first.' };

  const risk = record.riskAssessment
    ? [
        {
          kind: 'risk_assessment',
          path: record.riskAssessment.document,
          sha256: record.riskAssessment.sha256,
          summary: record.riskAssessment.summary,
          declaredBy: record.riskAssessment.declaredBy,
          declaredAt: record.riskAssessment.declaredAt,
        },
      ]
    : [];

  return {
    product: {
      name: product.name,
      version: product.version,
      productClass: product.productClass,
      ...(product.route ? { conformityRoute: product.route } : {}),
    },
    ...(record.recordHash ? { sourceRecordHash: record.recordHash } : {}),
    ...(record.schema ? { sourceSchema: record.schema } : {}),
    // Picked field by field, never spread. The record's supportPeriod also
    // carries declaredAt, and spreading it sent a key the server rejects. More
    // importantly, a spread means any field added to the record later leaves
    // this machine without anybody deciding that it should.
    supportPeriod: record.supportPeriod
      ? {
          until: record.supportPeriod.until,
          declaredBy: record.supportPeriod.declaredBy,
          ...(record.supportPeriod.rationale ? { rationale: record.supportPeriod.rationale } : {}),
        }
      : null,
    determinations: (record.annexI?.determined ?? []).map((d) => ({
      ref: d.ref,
      status: d.status,
      declaredBy: d.declaredBy,
      declaredAt: d.declaredAt,
      ...(d.rationale ? { rationale: d.rationale } : {}),
      declaredForVersion: d.declaredForVersion ?? null,
      staleForThisVersion: d.staleForThisVersion ?? false,
    })),
    documents: [
      ...risk,
      ...(record.documents ?? []).map((d) => ({
        kind: d.kind,
        path: d.document,
        sha256: d.sha256,
        summary: d.summary,
        declaredBy: d.declaredBy,
        declaredAt: d.declaredAt,
      })),
    ],
  };
}

export interface PushIo {
  cwd: string;
  log: (m: string) => void;
  error: (m: string) => void;
  post: (payload: PushPayload) => Promise<{ product: { id: string } }>;
}

export async function craPush(io: PushIo, opts: { dryRun?: boolean } = {}): Promise<number> {
  const path = join(io.cwd, 'compliance', 'cra', 'record.json');
  if (!existsSync(path)) {
    io.error(`No ${path}. Run \`legalithm cra record\` first.`);
    return 1;
  }

  let record: RecordShape;
  try {
    record = JSON.parse(readFileSync(path, 'utf8')) as RecordShape;
  } catch (e) {
    io.error(`Could not read the record: ${(e as Error).message}`);
    return 1;
  }

  const built = buildPayload(record);
  if ('error' in built) {
    io.error(built.error);
    return 1;
  }

  io.log(`Pushing ${built.product.name} ${built.product.version}`);
  io.log(`  determinations  ${built.determinations.length}`);
  io.log(`  documents       ${built.documents.length} (content hashes only, never the documents)`);
  io.log(`  support period  ${built.supportPeriod ? built.supportPeriod.until : 'not declared'}`);
  io.log('');
  io.log('  NOT sent, and the server refuses it if you try:');
  for (const w of WITHHELD) io.log(`    - ${w}`);
  io.log('');

  if (opts.dryRun) {
    io.log(JSON.stringify(built, null, 2));
    io.log('');
    io.log('Dry run. Nothing left this machine.');
    return 0;
  }

  try {
    await io.post(built);
  } catch (e) {
    io.error(`Push failed: ${(e as Error).message}`);
    return 3;
  }

  io.log('✓ Snapshot pushed.');
  io.log('  It is a view, not evidence. Your append-only record stays authoritative,');
  io.log('  and nothing on the server is signed.');
  return 0;
}
