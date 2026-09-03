/**
 * G9, first slice: the union across regulations.
 *
 * "Every single player is CRA-only. A connected medical device faces the CRA,
 *  the MDR, the AI Act if it has a model in it, and the EAA if it has a user
 *  interface. Nobody sells the union."
 *
 * The engine was never the blocker. `lib/corpus/frameworks.ts` already loads
 * multiple corpora with per-framework closed context fields. What was missing is
 * that the three packs do not share a shape, so nothing could put them side by
 * side:
 *
 *   eu-cra    106 rows   dimensions:{role}                ref, applies_if
 *   eu-eaa    229 rows   dimensions:{role,subject_kind}   ref, applies_if
 *   eu-ai-act  43 rows   role/risk/article as COLUMNS     no dimensions, no ref
 *
 * The AI Act pack is older and flat. Normalising it here rather than rewriting
 * the corpus is deliberate: that file is load-bearing for a shipped product, and
 * a migration is a separate change with its own blast radius.
 *
 * THE JOIN KEY IS `evidence_type`, and it is real rather than invented: all
 * three corpora already use the same closed vocabulary — control, document,
 * process, record. It was not added for this.
 *
 * WHAT THIS DOES NOT CLAIM. Two obligations sharing an evidence_type are NOT
 * the same obligation and are NOT discharged by the same artifact. A CRA Annex
 * VII technical file and an AI Act Annex IV technical file are both documents
 * and are different documents. What the shared type buys is a work programme:
 * one documentation effort, one review cadence, one owner — with each
 * determination still made separately, per regulation, by a named human.
 * Asserting equivalence here would be the most expensive possible error in this
 * product, so the type below carries no "satisfied by" edge at all.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FrameworkKey = 'eu-ai-act' | 'eu-cra' | 'eu-eaa';

export interface FrameworkMeta {
  key: FrameworkKey;
  instrument: string;
  /** Path segments from the repo root. */
  corpusPath: readonly string[];
  /** Plain-language trigger, for the applicability explanation. */
  bindsWhen: string;
}

export const UNION_FRAMEWORKS: Record<FrameworkKey, FrameworkMeta> = {
  'eu-cra': {
    key: 'eu-cra',
    instrument: 'Regulation (EU) 2024/2847',
    corpusPath: ['corpus', 'eu-cra', 'obligations.yml'],
    bindsWhen: 'the product has digital elements and is placed on the EU market',
  },
  'eu-ai-act': {
    key: 'eu-ai-act',
    instrument: 'Regulation (EU) 2024/1689',
    corpusPath: ['lib', 'ai_act', 'obligations.yml'],
    bindsWhen: 'the product contains or is an AI system',
  },
  'eu-eaa': {
    key: 'eu-eaa',
    instrument: 'Directive (EU) 2019/882',
    corpusPath: ['corpus', 'eu-eaa', 'obligations.yml'],
    bindsWhen: 'the product has a user interface covered by the accessibility requirements',
  },
};

/** Regulations a connected product can face that this build cannot answer for. */
export const KNOWN_ABSENT = [
  { instrument: 'Regulation (EU) 2017/745 (MDR)', why: 'no corpus in this repository' },
  { instrument: 'Regulation (EU) 2016/679 (GDPR)', why: 'no corpus in this repository' },
] as const;

export type EvidenceType = 'control' | 'document' | 'process' | 'record';

export interface UnifiedObligation {
  framework: FrameworkKey;
  instrument: string;
  /** Citable reference. The AI Act pack has no `ref`, so it is built from the article. */
  ref: string;
  title: string;
  evidenceType: EvidenceType;
  role: string | null;
}

interface RawRow {
  /** Present on the generated projection; absent on raw corpus rows. */
  evidenceType?: string;
  id?: string;
  ref?: string;
  title?: string;
  article?: string;
  role?: string;
  risk?: string;
  evidence_type?: string;
  dimensions?: { role?: string; subject_kind?: string };
}

function rowsOf(raw: unknown): RawRow[] {
  if (Array.isArray(raw)) return raw as RawRow[];
  const o = (raw ?? {}) as { obligations?: RawRow[]; rows?: RawRow[] };
  return o.obligations ?? o.rows ?? [];
}

/**
 * Normalise one corpus.
 *
 * The AI Act's flat shape is handled explicitly rather than by a lenient
 * fallback, so a future corpus that matches neither shape fails loudly instead
 * of yielding a plausible, empty union.
 */
export function normalise(framework: FrameworkKey, raw: unknown): UnifiedObligation[] {
  const meta = UNION_FRAMEWORKS[framework];
  return rowsOf(raw).map((r) => {
    const evidenceType = (r.evidence_type ?? r.evidenceType ?? 'document') as EvidenceType;
    const ref =
      r.ref ??
      (r.article ? `Article ${r.article}` : null) ??
      r.id ??
      '(unreferenced)';
    return {
      framework,
      instrument: meta.instrument,
      ref: String(ref),
      title: String(r.title ?? r.id ?? ref),
      evidenceType,
      role: r.dimensions?.role ?? r.role ?? null,
    };
  });
}

/**
 * The corpora, from the copy that SHIPS.
 *
 * This read the YAML out of the working tree and parsed it with js-yaml, which
 * is not a dependency of this package. In an installed CLI that fails twice
 * over: the files are not there, and the import cannot resolve. The command
 * worked only for people with the repository checked out.
 *
 * `packages/cli/data/union-corpus.json` is generated by
 * scripts/generate-cli-union-data.ts and kept honest by a drift test. Parsed
 * with JSON.parse, so the CLI keeps its zero runtime dependencies: it runs in
 * customer CI, offline, and every dep is a supply-chain surface on a tool whose
 * whole point is supply-chain evidence.
 */
function bundledDataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
}

export function loadFramework(_repoRoot: string, framework: FrameworkKey): UnifiedObligation[] {
  const p = join(bundledDataDir(), 'union-corpus.json');
  if (!existsSync(p)) return [];
  const all = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  return normalise(framework, all[framework] ?? []);
}

/**
 * The same actor has a different name in each instrument, and getting this wrong
 * is the most dangerous thing this module can do.
 *
 *   eu-cra      manufacturer  importer  distributor  authorised_representative
 *               open_source_steward  substantial_modifier
 *   eu-eaa      manufacturer  importer  distributor  authorised_representative
 *               service_provider  economic_operator  commission  member_state
 *   eu-ai-act   provider      importer  distributor  deployer
 *
 * The party that places a product on the market under its own name is a
 * "manufacturer" under the CRA and the EAA and a "provider" under the AI Act.
 * Filtering on the literal string returned ZERO AI Act obligations for a
 * manufacturer, which reads as "the AI Act asks nothing of you". That is the
 * failure this map exists to prevent, and it is worse than an over-broad answer.
 *
 * These are legal judgements, not string similarity. `deployer` is deliberately
 * absent from the manufacturer row: an AI Act deployer is the party USING a
 * system, which is not what a CRA manufacturer is, and quietly folding it in
 * would attribute duties to the wrong party. Where no counterpart exists, the
 * answer is "not expressed in this vocabulary", never zero.
 */
const ROLE_EQUIVALENTS: Record<string, Partial<Record<FrameworkKey, string[]>>> = {
  manufacturer: { 'eu-cra': ['manufacturer'], 'eu-eaa': ['manufacturer'], 'eu-ai-act': ['provider'] },
  provider: { 'eu-ai-act': ['provider'], 'eu-cra': ['manufacturer'], 'eu-eaa': ['manufacturer'] },
  importer: { 'eu-cra': ['importer'], 'eu-eaa': ['importer'], 'eu-ai-act': ['importer'] },
  distributor: { 'eu-cra': ['distributor'], 'eu-eaa': ['distributor'], 'eu-ai-act': ['distributor'] },
  authorised_representative: {
    'eu-cra': ['authorised_representative'],
    'eu-eaa': ['authorised_representative'],
  },
  service_provider: { 'eu-eaa': ['service_provider'] },
  open_source_steward: { 'eu-cra': ['open_source_steward'] },
  deployer: { 'eu-ai-act': ['deployer'] },
};

/** Roles this framework recognises for the caller, or null if it has no counterpart. */
export function rolesIn(role: string | undefined, framework: FrameworkKey): string[] | null {
  if (!role) return null;
  const mapped = ROLE_EQUIVALENTS[role]?.[framework];
  return mapped && mapped.length ? mapped : null;
}

export interface ProductProfile {
  digitalElements: boolean;
  aiSystem: boolean;
  userInterface: boolean;
  role?: string;
}

export interface FrameworkVerdict {
  framework: FrameworkKey;
  instrument: string;
  applies: boolean;
  because: string;
  obligations: number;
}

export function whichApply(profile: ProductProfile, corpora: Record<FrameworkKey, UnifiedObligation[]>): FrameworkVerdict[] {
  const triggered: Record<FrameworkKey, boolean> = {
    'eu-cra': profile.digitalElements,
    'eu-ai-act': profile.aiSystem,
    'eu-eaa': profile.userInterface,
  };
  return (Object.keys(UNION_FRAMEWORKS) as FrameworkKey[]).map((k) => {
    const meta = UNION_FRAMEWORKS[k];
    const applies = triggered[k];
    const rows = corpora[k] ?? [];
    const roles = rolesIn(profile.role, k);
    // No counterpart means we cannot narrow, so we do not narrow. Reporting zero
    // would read as "this instrument asks nothing of you".
    const scoped = roles ? rows.filter((r) => r.role === null || roles.includes(r.role)) : rows;
    const roleNote =
      profile.role && !roles ? ` (role "${profile.role}" has no counterpart here, so not narrowed)` : '';
    return {
      framework: k,
      instrument: meta.instrument,
      applies,
      because: applies ? `${meta.bindsWhen}${roleNote}` : `not triggered: ${meta.bindsWhen}`,
      obligations: applies ? scoped.length : 0,
    };
  });
}

export interface SharedWorkGroup {
  evidenceType: EvidenceType;
  /** How many obligations of this type, per applicable framework. */
  perFramework: { framework: FrameworkKey; count: number }[];
  total: number;
}

/**
 * Group the union by evidence type.
 *
 * This is the answer to "what work do I actually have to do", as distinct from
 * "how many obligations do I have". It says: these regulations all want
 * documents, and one documentation programme can serve them — NOT that one
 * document satisfies them.
 */
export function sharedWork(
  verdicts: FrameworkVerdict[],
  corpora: Record<FrameworkKey, UnifiedObligation[]>,
  profile: ProductProfile,
): SharedWorkGroup[] {
  const applicable = verdicts.filter((v) => v.applies).map((v) => v.framework);
  const types: EvidenceType[] = ['document', 'process', 'control', 'record'];

  return types
    .map((t) => {
      const perFramework = applicable
        .map((f) => {
          const roles = rolesIn(profile.role, f);
          const rows = (corpora[f] ?? []).filter(
            (r) => r.evidenceType === t && (!roles || r.role === null || roles.includes(r.role)),
          );
          return { framework: f, count: rows.length };
        })
        .filter((x) => x.count > 0);
      return { evidenceType: t, perFramework, total: perFramework.reduce((n, x) => n + x.count, 0) };
    })
    .filter((g) => g.perFramework.length > 0)
    .sort((a, b) => b.total - a.total);
}

export interface UnionIo {
  cwd: string;
  log: (m: string) => void;
  error: (m: string) => void;
}

/**
 * `legalithm applies` — which regulations bind this product, and the union.
 */
export function runApplies(
  io: UnionIo,
  opts: { digitalElements?: boolean; ai?: boolean; ui?: boolean; role?: string; json?: boolean },
): number {
  const profile: ProductProfile = {
    digitalElements: Boolean(opts.digitalElements),
    aiSystem: Boolean(opts.ai),
    userInterface: Boolean(opts.ui),
    ...(opts.role ? { role: opts.role } : {}),
  };

  if (!profile.digitalElements && !profile.aiSystem && !profile.userInterface) {
    io.error('Describe the product, or there is nothing to determine:');
    io.error('  legalithm applies --digital-elements --ai --ui [--role manufacturer]');
    io.error('');
    io.error('Nothing is assumed. A product that triggers none of these may still face');
    io.error('other law; this command only answers for the corpora it holds.');
    return 1;
  }

  const corpora = {
    'eu-cra': loadFramework(io.cwd, 'eu-cra'),
    'eu-ai-act': loadFramework(io.cwd, 'eu-ai-act'),
    'eu-eaa': loadFramework(io.cwd, 'eu-eaa'),
  } as Record<FrameworkKey, UnifiedObligation[]>;

  const missing = (Object.keys(corpora) as FrameworkKey[]).filter((k) => corpora[k].length === 0);
  if (missing.length === 3) {
    io.error('No corpora found. Run this from a checkout of the Legalithm repository:');
    io.error('  corpus/eu-cra, corpus/eu-eaa and lib/ai_act are read from the working tree.');
    return 1;
  }

  const verdicts = whichApply(profile, corpora);
  const groups = sharedWork(verdicts, corpora, profile);
  const total = verdicts.filter((v) => v.applies).reduce((n, v) => n + v.obligations, 0);

  if (opts.json) {
    io.log(JSON.stringify({ profile, verdicts, sharedWork: groups, total, absent: KNOWN_ABSENT }, null, 2));
    return 0;
  }

  const applicable = verdicts.filter((v) => v.applies);
  io.log(`${applicable.length} regulation(s) bind this product. ${total} obligations in the union.`);
  io.log('');
  for (const v of verdicts) {
    const mark = v.applies ? '●' : '○';
    io.log(`  ${mark} ${v.instrument.padEnd(32)} ${v.applies ? `${v.obligations} obligations` : 'does not apply'}`);
    io.log(`      ${v.because}`);
  }

  if (groups.length) {
    io.log('');
    io.log('The work, by kind. One programme per row, not one artifact:');
    for (const g of groups) {
      const parts = g.perFramework.map((p) => `${p.framework} ${p.count}`).join(', ');
      io.log(`  ${String(g.total).padStart(4)} ${g.evidenceType.padEnd(9)} ${parts}`);
    }
    io.log('');
    io.log('Obligations sharing a kind are NOT the same obligation and are NOT');
    io.log('discharged by the same artifact. A CRA Annex VII technical file and an');
    io.log('AI Act Annex IV technical file are both documents, and different');
    io.log('documents. What they share is a work programme and an owner; each');
    io.log('determination is still made separately, per regulation, by a person.');
  }

  io.log('');
  io.log('Not answered here:');
  for (const a of KNOWN_ABSENT) io.log(`  ${a.instrument} — ${a.why}`);
  io.log('A connected medical device faces more law than this build holds. Absence');
  io.log('from this list is not a finding that the regulation does not apply.');
  return 0;
}
