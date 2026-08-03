// Article 50 transparency disclosure templates for the offline MCP server.
//
// T6.2: this file used to hold its own copy of the templates. It is published to
// npm, so its wording reached users independently of the product's and neither
// knew about the other — the corpus said "AI-generated" while this said a full
// sentence, for the same obligation.
//
// The text now comes from disclosures.json, generated from
// lib/ai_act/disclosure-corpus.yml (`long_form` register) by
// scripts/generate-mcp-disclosures-json.ts. Do not edit the strings here.
//
// asOf / engineVersion are stamped by tools.ts (RULES_ENGINE_META) on every response.
import corpus from './disclosures.json';

export type DisclosureScenario = 'chatbot' | 'genai-content' | 'deepfake' | 'emotion';

interface LongFormEntry {
  paragraph: string;
  [lang: string]: string;
}

const LONG_FORM = corpus.longForm as Record<string, LongFormEntry>;

export interface DisclosureResult {
  scenario: DisclosureScenario;
  locale: 'en' | 'de';
  text: string;
  /** e.g. "Article 50(1)" — the paragraph is corpus data, not a literal here. */
  article: string;
  citationUrl: string;
  /** Corpus version the text came from, so a stale bundle is detectable. */
  corpusVersion: string;
  corpusUpdatedAt: string;
}

export function generateDisclosure(
  scenario: DisclosureScenario,
  locale: 'en' | 'de' = 'en',
): DisclosureResult {
  const entry = LONG_FORM[scenario];
  if (!entry) {
    throw new Error(
      `Unknown disclosure scenario "${scenario}". Available: ${Object.keys(LONG_FORM).join(', ')}`,
    );
  }

  // Fall back to English rather than returning undefined: long_form is EN/DE
  // today and a missing translation must not silently produce an empty
  // disclosure artifact.
  const text = entry[locale] ?? entry.en;

  return {
    scenario,
    locale,
    text,
    article: `Article ${entry.paragraph}`,
    citationUrl: corpus.meta.referenceUrl,
    corpusVersion: corpus.meta.version,
    corpusUpdatedAt: corpus.meta.updatedAt,
  };
}

export const DISCLOSURE_SCENARIOS = Object.keys(LONG_FORM) as DisclosureScenario[];
