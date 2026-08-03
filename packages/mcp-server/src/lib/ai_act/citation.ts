import type { Citation } from './types';
import { RULES_ENGINE_UPDATED_AT } from './version';
import { getAppliesFromForArticle } from './enforcement-dates';

export type CitationInput = {
  article?: string;
  annex?: string;
  url: string;
  label: string;
  /** Override corpus as-of (defaults to RULES_ENGINE_UPDATED_AT). */
  asOf?: string;
  /** Override applies-from (defaults to getAppliesFromForArticle(article)). */
  appliesFrom?: string | null;
};

/**
 * Build a dated Citation. `asOf` is the rules corpus updatedAt; `appliesFrom`
 * is filled from enforcement-dates when the article maps to a milestone.
 */
export function buildCitation(input: CitationInput): Citation {
  const asOf = input.asOf ?? RULES_ENGINE_UPDATED_AT;
  const fromMilestone =
    input.article !== undefined ? getAppliesFromForArticle(input.article) : undefined;
  const appliesFrom =
    input.appliesFrom === null
      ? undefined
      : (input.appliesFrom ?? fromMilestone);

  const citation: Citation = {
    url: input.url,
    label: input.label,
    asOf,
  };
  if (input.article !== undefined) citation.article = input.article;
  if (input.annex !== undefined) citation.annex = input.annex;
  if (appliesFrom !== undefined) citation.appliesFrom = appliesFrom;
  return citation;
}
