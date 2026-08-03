import riskMap from './risk_map.json';
import changelogData from './rules-changelog.json';
import obligationsMeta from './obligations-meta.json';

/**
 * P1-C2: the single source of truth for the rules-corpus version and its change
 * history. The version lives in risk_map.yml (`meta.version`) and flows into
 * risk_map.json via scripts/generate-risk-map-json.ts. Everything that stamps an
 * "engine version" reads it from here, so bumping the corpus bumps the stamp.
 *
 * T4.2: obligations.yml has its own meta block, exposed as OBLIGATIONS_META.
 */

export interface RulesEngineMeta {
  version: string;
  updatedAt: string;
  regulation?: string;
  notes?: string;
  amendments?: string[];
}

export interface StructuredChangelogChange {
  article: string;
  paragraph: string | null;
  from_date: string | null;
  to_date: string | null;
  instrument: string;
  change?: string;
}

export interface RulesChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
  /** Structured diff rows (T5.3 changefeed v2). */
  structuredChanges?: StructuredChangelogChange[];
  /** Primary amending instrument for this release, e.g. reg-2026-1744. */
  instrument?: string;
  /** ISO date when the instrument entered into force (from enforcement-dates LEGAL_INSTRUMENTS). */
  instrumentInForce?: string;
  sources?: string[];
  notes?: string;
}

const meta = ((riskMap as { meta?: RulesEngineMeta }).meta) ?? {
  version: '0.0.0',
  updatedAt: 'unknown',
};

export const RULES_ENGINE_META: RulesEngineMeta = meta;
export const RULES_ENGINE_VERSION = meta.version;
export const RULES_ENGINE_UPDATED_AT = meta.updatedAt;

/**
 * Obligations corpus meta (obligations.yml), parallel to RULES_ENGINE_META.
 *
 * Read from the generated obligations-meta.json, NOT from the YAML: this module
 * is reachable from client components (PublicAssessmentWizard -> classify ->
 * engine -> citation -> version), and a readFileSync here puts `fs` in the
 * browser bundle and breaks `next build`. Same reason risk_map.json exists.
 * Regenerate with scripts/generate-obligations-meta-json.ts.
 */
export const OBLIGATIONS_META: RulesEngineMeta = obligationsMeta;
export const OBLIGATIONS_VERSION = OBLIGATIONS_META.version;
export const OBLIGATIONS_UPDATED_AT = OBLIGATIONS_META.updatedAt;

/** Change history, newest first. */
export function getRulesChangelog(): RulesChangelogEntry[] {
  return [...(changelogData as RulesChangelogEntry[])].sort((a, b) => (a.date < b.date ? 1 : -1));
}
