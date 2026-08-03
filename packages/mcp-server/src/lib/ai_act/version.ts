import riskMap from './risk_map.json';
import changelogData from './rules-changelog.json';

/**
 * P1-C2: the single source of truth for the rules-corpus version and its change
 * history. The version lives in risk_map.yml (`meta.version`) and flows into
 * risk_map.json via scripts/generate-risk-map-json.ts. Everything that stamps an
 * "engine version" reads it from here, so bumping the corpus bumps the stamp.
 */

export interface RulesEngineMeta {
  version: string;
  updatedAt: string;
  regulation?: string;
  notes?: string;
}

export interface RulesChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
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

/** Change history, newest first. */
export function getRulesChangelog(): RulesChangelogEntry[] {
  return [...(changelogData as RulesChangelogEntry[])].sort((a, b) => (a.date < b.date ? 1 : -1));
}
