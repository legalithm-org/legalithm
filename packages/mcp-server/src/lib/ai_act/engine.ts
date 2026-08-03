import riskMap from './risk_map.json';
import type { Citation, Domain, RiskResult, RiskLevel, UseCase } from './types';
import { ENFORCEMENT_MILESTONES_BY_ID } from './enforcement-dates';
import { buildCitation } from './citation';

const EURLEX_BASE = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401689';
const ANNEX_I_DEADLINE = ENFORCEMENT_MILESTONES_BY_ID['high-risk-annex-i'].date!;
const ANNEX_III_DEADLINE = ENFORCEMENT_MILESTONES_BY_ID['high-risk-annex-iii'].date!;

/** Below this numeric confidence the engine abstains: it flags reviewRequired and
 *  defers to legal review instead of asserting a classification. */
export const ABSTENTION_THRESHOLD = 0.6;

// Confidence scores per decision path (calibrated so the >=0.85 band is the
// "assert" band and everything below is increasingly "verify"). The accuracy
// suite asserts that the >=0.85 band is >=0.95 accurate.
const SCORE = {
  prohibited: 0.95,
  highRiskPattern: 0.92,
  highRiskDomainOnly: 0.72,
  gpaiSystemic: 0.9,
  gpaiStandard: 0.88,
  limitedTransparency: 0.85,
  article6_3Exception: 0.55,
  minimalFallback: 0.4,
} as const;

// Natural-language clause per Article 50 trigger (the raw category titles read
// awkwardly mid-sentence, e.g. "interacting with chatbot disclosure").
const LIMITED_CLAUSE: Record<string, string> = {
  chatbot: 'an AI system people interact with directly (e.g. a chatbot or virtual assistant), so users must be told they are talking to AI',
  deepfake: 'capable of generating synthetic or manipulated content (e.g. deepfakes), so that content must be marked as AI-generated',
  emotion_recognition: 'an emotion-recognition system, so the people exposed to it must be informed',
};

/**
 * Maps the STRUCTURED domain a user selects to its high-risk category id
 * in risk_map.json. Medical maps to the Article 6(1)/Annex I safety-component
 * path; other domains map to Annex III categories under Article 6(2).
 */
const DOMAIN_TO_HIGH_RISK_CATEGORY: Record<Domain, string | null> = {
  biometrics: 'biometric_identification',
  employment: 'employment',
  credit: 'essential_services',
  medical: 'medical',
  education: 'education',
  'law-enforcement': 'law_enforcement',
  other: null,
};

interface RiskCategory {
  id: string;
  title: string;
  patterns: string[];
  examples?: string[];
  annex_area?: number | string;
  article?: string;
  annex?: string;
}

interface RiskRule {
  level?: RiskLevel;
  article?: string;
  annex?: string;
  title: string;
  url: string;
  patterns?: string[];
  categories?: RiskCategory[];
}

// Negators that, when they appear just before a matched phrase, flip a positive
// substring hit into a non-match ("this system does NOT perform biometric ID").
const NEGATION_RE = /\b(not|never|without|excludes|excluding|rather than|instead of)\b|n't\b|\bno\b/;

/**
 * Negation-aware, start-boundary containment. Replaces the old naive `includes`,
 * which (a) matched a pattern embedded inside a larger word (false positive:
 * "election" inside "selection") and (b) ignored negation ("not used for X"
 * matched "X"). `text` is assumed already lower-cased.
 *
 * Only the START boundary is enforced (char before the match must be a
 * non-word char). The END is intentionally left open so inflections still
 * match ("biometric identifications" → "biometric identification"), for a
 * compliance classifier a false negative (missing real risk) is worse than a
 * mild false positive.
 */
function patternMatches(text: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (!p) return false;
  let from = 0;
  for (;;) {
    const i = text.indexOf(p, from);
    if (i === -1) return false;
    const before = i === 0 ? '' : text[i - 1]!;
    const startBounded = !/[a-z0-9]/.test(before);
    if (startBounded) {
      const pre = text.slice(Math.max(0, i - 30), i);
      if (!NEGATION_RE.test(pre)) return true;
    }
    from = i + 1;
  }
}

function checkPatterns(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => patternMatches(text, pattern));
}

type CoreResult = Omit<RiskResult, 'confidenceScore' | 'reviewRequired'>;

/** Attach the numeric confidence + abstention flag to a classification. */
function finalize(result: CoreResult, score: number): RiskResult {
  return { ...result, confidenceScore: score, reviewRequired: score < ABSTENTION_THRESHOLD };
}

function deriveArticle6_3Exceptions(
  useCaseText: string,
  explicit?: UseCase['article6_3_exceptions'],
): UseCase['article6_3_exceptions'] | undefined {
  const text = useCaseText.toLowerCase();

  // Accept explicit flags from structured inputs first.
  const merged: NonNullable<UseCase['article6_3_exceptions']> = {
    narrowProceduralTask: Boolean(explicit?.narrowProceduralTask),
    improvesHumanActivity: Boolean(explicit?.improvesHumanActivity),
    detectsPatternsOnly: Boolean(explicit?.detectsPatternsOnly),
    preparatoryTask: Boolean(explicit?.preparatoryTask),
  };

  // Fallback inference for free-text descriptions that clearly describe Article 6(3) conditions.
  if (
    /\bnarrow procedural task\b/.test(text) ||
    /\bprocedural support only\b/.test(text)
  ) {
    merged.narrowProceduralTask = true;
  }
  if (
    /\bimproves (a )?(previously completed|prior) human (activity|assessment)\b/.test(text) ||
    /\baugment(s)? prior human assessment\b/.test(text)
  ) {
    merged.improvesHumanActivity = true;
  }
  if (
    /\bdetects? patterns only\b/.test(text) ||
    /\bwithout replacing human (assessment|judgment|judgement)\b/.test(text)
  ) {
    merged.detectsPatternsOnly = true;
  }
  if (
    /\bpreparatory task\b/.test(text) ||
    /\bpre-screening support\b/.test(text)
  ) {
    merged.preparatoryTask = true;
  }

  if (
    merged.narrowProceduralTask ||
    merged.improvesHumanActivity ||
    merged.detectsPatternsOnly ||
    merged.preparatoryTask
  ) {
    return merged;
  }

  return undefined;
}

/**
 * Canonical AI Act classification engine used by both server and client wrappers.
 * Source of truth: risk_map.yml -> risk_map.json.
 */
export function classifyUseCase(useCase: UseCase): RiskResult {
  const text = useCase.use_case.toLowerCase();
  const matchedRules: string[] = [];
  const citations: Citation[] = [];

  const unacceptableRule = riskMap.unacceptable as RiskRule;
  if (checkPatterns(text, unacceptableRule.patterns || [])) {
    matchedRules.push('unacceptable_practices');
    citations.push(buildCitation({
      article: '5',
      url: `${EURLEX_BASE}#article-5`,
      label: 'Article 5 - Prohibited AI Practices',
    }));

    return finalize(
      {
        risk: 'unacceptable',
        confidence: 'high',
        rationale:
          'This AI system falls under prohibited practices as defined in Article 5 of the AI Act, including social scoring, real-time biometric identification in public spaces, or manipulation of persons.',
        citations,
        matchedRules,
        obligationsHint: { count: 0, topTitles: [] },
      },
      SCORE.prohibited,
    );
  }

  const highRiskRule = riskMap.high_risk as RiskRule;
  const domainCategoryId = DOMAIN_TO_HIGH_RISK_CATEGORY[useCase.domain];
  for (const category of highRiskRule.categories || []) {
    const patternMatched = checkPatterns(text, category.patterns);
    const matchedByDomain = domainCategoryId !== null && domainCategoryId === category.id;
    if (matchedByDomain || patternMatched) {
      matchedRules.push(`high_risk_${category.id}`);
      if (matchedByDomain) {
        matchedRules.push('high_risk_domain_selected');
      }

      const isAnnexI =
        category.annex === 'I' || category.article === '6(1)';

      // Article 6(3) exceptions apply only to Annex III / Article 6(2) systems.
      if (!isAnnexI) {
        const exceptions = deriveArticle6_3Exceptions(text, useCase.article6_3_exceptions);
        if (exceptions) {
          const appliedExceptions: string[] = [];
          if (exceptions.narrowProceduralTask) {
            appliedExceptions.push('performs a narrow procedural task');
          }
          if (exceptions.improvesHumanActivity) {
            appliedExceptions.push('improves the result of a previously completed human activity');
          }
          if (exceptions.detectsPatternsOnly) {
            appliedExceptions.push('detects decision-making patterns without replacing human assessment');
          }
          if (exceptions.preparatoryTask) {
            appliedExceptions.push('performs a preparatory task for an assessment');
          }

          if (appliedExceptions.length > 0) {
            matchedRules.push('article_6_3_exception');
            citations.push(buildCitation({
              article: '6(3)',
              url: `${EURLEX_BASE}#article-6`,
              label: 'Article 6(3) - Exception from High-Risk Classification',
            }));

            return finalize(
              {
                risk: 'limited',
                confidence: 'medium',
                rationale: `This AI system matches Annex III category "${category.title}", but may qualify for an Article 6(3) exception because it ${appliedExceptions.join(' and ')}. The exception is inferred and NOT certain, the provider must document and legally verify this assessment. Transparency obligations under Article 50 may still apply.`,
                citations,
                matchedRules,
                obligationsHint: {
                  count: 2,
                  topTitles: [
                    'Document Article 6(3) Exception Assessment',
                    'Transparency Obligations (Article 50)',
                  ],
                },
              },
              SCORE.article6_3Exception,
            );
          }
        }
      }

      if (isAnnexI) {
        citations.push(buildCitation({
          article: '6(1)',
          annex: 'I',
          url: `${EURLEX_BASE}#article-6`,
          label: 'Article 6(1) & Annex I - High-Risk AI Systems (Product Safety Components)',
        }));

        return finalize(
          {
            risk: 'high',
            confidence: 'high',
            rationale: `This AI system is classified as high-risk under Article 6(1) because it is (or is a safety component of) a product covered by Union harmonisation legislation listed in Annex I (e.g. medical devices). It is not an Annex III standalone system. High-risk obligations for this path apply from ${ANNEX_I_DEADLINE}.`,
            citations,
            matchedRules,
            applicableDeadline: ANNEX_I_DEADLINE,
            obligationsHint: {
              count: 10,
              topTitles: [
                'Quality Management System (Article 17)',
                'Data Governance (Article 10)',
                'Technical Documentation (Article 11)',
                'Human Oversight (Article 14)',
              ],
            },
          },
          patternMatched ? SCORE.highRiskPattern : SCORE.highRiskDomainOnly,
        );
      }

      citations.push(buildCitation({
        article: '6(2)',
        annex: 'III',
        url: `${EURLEX_BASE}#article-6`,
        label: 'Article 6(2) & Annex III - High-Risk AI Systems',
      }));

      return finalize(
        {
          risk: 'high',
          confidence: 'high',
          rationale: `This AI system is classified as high-risk under Article 6(2) as it falls into the category of ${category.title} as specified in Annex III. It requires compliance with Article 8-51 obligations including quality management systems, data governance, technical documentation, and human oversight.`,
          citations,
          matchedRules,
          applicableDeadline: ANNEX_III_DEADLINE,
          obligationsHint: {
            count: 10,
            topTitles: [
              'Quality Management System (Article 17)',
              'Data Governance (Article 10)',
              'Technical Documentation (Article 11)',
              'Human Oversight (Article 14)',
            ],
          },
        },
        patternMatched ? SCORE.highRiskPattern : SCORE.highRiskDomainOnly,
      );
    }
  }

  // GPAI / Chapter V (Articles 51-56). Obligations sit on the PROVIDER of a
  // general-purpose model, a deployer merely USING an LLM is not a GPAI provider
  // (it gets Article 50 transparency below). So gate on role === 'provider'.
  const gpaiRule = riskMap.gpai as RiskRule;
  if (useCase.role === 'provider') {
    const categories = gpaiRule.categories || [];
    const systemic = categories.find((c) => c.id === 'gpai_systemic');
    const standard = categories.find((c) => c.id === 'gpai_standard');
    const isSystemic = Boolean(systemic && checkPatterns(text, systemic.patterns));
    const isStandard = Boolean(standard && checkPatterns(text, standard.patterns));

    if (isSystemic || isStandard) {
      matchedRules.push(isSystemic ? 'gpai_systemic' : 'gpai_standard');
      citations.push(buildCitation({
        article: '53',
        url: `${EURLEX_BASE}#chapter-V`,
        label: 'Article 53 - GPAI Model Obligations (Chapter V)',
      }));
      if (isSystemic) {
        citations.push(buildCitation({
          article: '55',
          url: `${EURLEX_BASE}#chapter-V`,
          label: 'Article 55 - GPAI Models with Systemic Risk',
        }));
      }

      return finalize(
        {
          risk: 'high',
          confidence: 'high',
          gpai: true,
          rationale: isSystemic
            ? 'This is a general-purpose AI model with systemic risk under Chapter V. The provider must meet Article 53 obligations PLUS the Article 55 systemic-risk duties (model evaluation, adversarial testing, systemic-risk assessment and mitigation, serious-incident reporting, cybersecurity).'
            : 'This is a general-purpose AI model under Chapter V. The provider must meet Article 53 obligations: technical documentation, information for downstream providers, a copyright-compliance policy, and a public training-content summary.',
          citations,
          matchedRules,
          obligationsHint: {
            count: isSystemic ? 8 : 4,
            topTitles: isSystemic
              ? [
                  'Model Evaluation & Adversarial Testing (Article 55)',
                  'Systemic-Risk Assessment & Mitigation (Article 55)',
                  'Technical Documentation (Article 53)',
                  'Serious-Incident Reporting (Article 55)',
                ]
              : [
                  'Technical Documentation (Article 53)',
                  'Downstream-Provider Information (Article 53)',
                  'Copyright-Compliance Policy (Article 53)',
                  'Training-Content Summary (Article 53)',
                ],
          },
        },
        isSystemic ? SCORE.gpaiSystemic : SCORE.gpaiStandard,
      );
    }
  }

  const limitedRiskRule = riskMap.limited_risk as RiskRule;
  for (const category of limitedRiskRule.categories || []) {
    if (checkPatterns(text, category.patterns)) {
      matchedRules.push(`limited_risk_${category.id}`);
      citations.push(buildCitation({
        article: '50',
        url: `${EURLEX_BASE}#article-50`,
        label: 'Article 50 - Transparency Obligations',
      }));

      return finalize(
        {
          risk: 'limited',
          confidence: 'high',
          rationale: `This AI system has limited-risk transparency obligations under Article 50: it is ${LIMITED_CLAUSE[category.id] ?? 'subject to Article 50, so users must be informed they are interacting with an AI system'}.`,
          citations,
          matchedRules,
          obligationsHint: {
            count: 2,
            topTitles: ['User Notification', 'Transparent Communication'],
          },
        },
        SCORE.limitedTransparency,
      );
    }
  }

  return finalize(
    {
      risk: 'minimal',
      confidence: 'low',
      rationale:
        'No prohibited, high-risk, GPAI, or limited-risk transparency trigger matched the current rules, so this AI system appears minimal-risk. This is a preliminary, low-confidence result, the rules are keyword-based and may miss a novel or implicitly-described use case, so it is flagged for legal review rather than asserted.',
      citations: [],
      matchedRules,
      obligationsHint: { count: 0, topTitles: [] },
    },
    SCORE.minimalFallback,
  );
}
