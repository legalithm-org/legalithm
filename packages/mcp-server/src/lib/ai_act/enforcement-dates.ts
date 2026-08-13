/**
 * Single source of truth for EU AI Act enforcement milestones.
 *
 * Dates and article refs come only from the wave-1 canonical pack
 * (Regulation (EU) 2024/1689 as amended by Regulation (EU) 2026/1744,
 * Digital Omnibus on AI). Do not invent dates here.
 */

export type EnforcementStatus = 'enforced' | 'upcoming' | 'future' | 'conditional';

export type EnforcementMilestoneId =
  | 'entry-into-force'
  | 'art-5-prohibited'
  | 'gpai-chapter-v'
  | 'art-50-transparency'
  | 'ncii-csam-ban'
  | 'art-111-4-preexisting-synthetic'
  | 'high-risk-annex-iii'
  | 'high-risk-annex-i'
  | 'art-112-review-1'
  | 'art-112-full-evaluation'
  | 'art-111-2-public-authorities'
  | 'annex-x-large-scale-it'
  | 'art-111-2-legacy-high-risk';

export interface EnforcementArticleRef {
  label: string;
  /** Guide article slug when a dedicated page exists. */
  slug?: string;
}

export interface EnforcementMilestone {
  id: EnforcementMilestoneId;
  /** ISO date (YYYY-MM-DD), or null for condition-only milestones. */
  date: string | null;
  articleRefs: readonly EnforcementArticleRef[];
  /** Key under aiActGuide.timelineData.<key> */
  timelineI18nKey: string;
  /**
   * Key under marketing.deadlineCountdown.milestones.<key>.
   * Present only when showInCountdown is true.
   */
  countdownI18nKey?: string;
  showInCountdown: boolean;
  /** English title for the public API surface. */
  title: string;
  /** English description for the public API surface. */
  description: string;
  affectsRiskLevel: readonly string[];
}

const MILESTONE_LIST: readonly EnforcementMilestone[] = [
  {
    id: 'entry-into-force',
    date: '2024-08-01',
    articleRefs: [{ label: 'Article 113', slug: 'article-113' }],
    timelineI18nKey: 'entryIntoForce',
    showInCountdown: false,
    title: 'AI Act Entry into Force',
    description:
      'Regulation (EU) 2024/1689 officially entered into force. The transition period began.',
    affectsRiskLevel: ['all'],
  },
  {
    id: 'art-5-prohibited',
    date: '2025-02-02',
    articleRefs: [
      { label: 'Article 5', slug: 'article-5-prohibited-practices' },
      { label: 'Article 99 (Fines)', slug: 'article-99' },
    ],
    timelineI18nKey: 'prohibitedPractices',
    countdownI18nKey: 'prohibited',
    showInCountdown: true,
    title: 'Prohibited Practices Enforceable',
    description:
      'Article 5 prohibited AI practices are enforceable. Systems involving social scoring, subliminal manipulation, exploitation of vulnerabilities, real-time biometric identification in public spaces, emotion recognition in workplace/education, predictive policing based solely on profiling, and untargeted facial image scraping must be discontinued.',
    affectsRiskLevel: ['unacceptable', 'prohibited'],
  },
  {
    id: 'gpai-chapter-v',
    date: '2025-08-02',
    articleRefs: [
      { label: 'Article 51', slug: 'article-51' },
      { label: 'Article 52', slug: 'article-52' },
      { label: 'Article 53', slug: 'article-53' },
      { label: 'Article 55', slug: 'article-55' },
      { label: 'Article 56', slug: 'article-56' },
      { label: 'Article 100 (GPAI Fines)', slug: 'article-100' },
    ],
    timelineI18nKey: 'gpaiObligations',
    countdownI18nKey: 'gpai',
    showInCountdown: true,
    title: 'GPAI Model Obligations',
    description:
      'Chapter V obligations for General-Purpose AI (GPAI) models take effect. Providers must comply with transparency, documentation, copyright, and energy reporting requirements. Systemic risk models have additional evaluation and incident reporting duties.',
    affectsRiskLevel: ['gpai_standard', 'gpai_systemic'],
  },
  {
    id: 'art-50-transparency',
    date: '2026-08-02',
    articleRefs: [{ label: 'Article 50', slug: 'article-50' }],
    timelineI18nKey: 'art50Transparency',
    countdownI18nKey: 'art50',
    showInCountdown: true,
    title: 'Article 50 Transparency Obligations',
    description:
      'Article 50 transparency obligations apply. Providers and deployers of certain AI systems must inform natural persons that they are interacting with AI, and mark synthetic audio, image, video, or text content as artificially generated or manipulated, subject to the Article 50 conditions.',
    affectsRiskLevel: ['limited'],
  },
  {
    id: 'ncii-csam-ban',
    date: '2026-12-02',
    articleRefs: [
      { label: 'Article 5(1)(ba)', slug: 'article-5-prohibited-practices' },
      { label: 'Article 5(1)(bb)', slug: 'article-5-prohibited-practices' },
      { label: 'Article 5(1a)', slug: 'article-5-prohibited-practices' },
      { label: 'Article 5(1b)', slug: 'article-5-prohibited-practices' },
      { label: 'Article 113(3)(a)' },
    ],
    timelineI18nKey: 'nciiCsamBan',
    showInCountdown: false,
    title: 'NCII / CSAM Ban (Art 5)',
    description:
      'Article 5(1), first subparagraph, points (ba) and (bb), and Article 5(1a) and (1b) apply from this date (Article 113(3)(a) as amended by Regulation (EU) 2026/1744). These are distinct from the Article 50(2) pre-existing synthetic-content marking deadline on the same calendar day.',
    affectsRiskLevel: ['unacceptable', 'prohibited'],
  },
  {
    id: 'art-111-4-preexisting-synthetic',
    date: '2026-12-02',
    articleRefs: [
      { label: 'Article 111(4)' },
      { label: 'Article 50(2)', slug: 'article-50' },
    ],
    timelineI18nKey: 'art1114PreexistingSynthetic',
    showInCountdown: false,
    title: 'Pre-existing Synthetic-Content Systems (Art 50(2))',
    description:
      'AI systems generating synthetic content that were placed on the market before 2 August 2026 must meet Article 50(2) marking obligations by this date (Article 111(4), as added by Regulation (EU) 2026/1744).',
    affectsRiskLevel: ['limited'],
  },
  {
    id: 'high-risk-annex-iii',
    date: '2027-12-02',
    articleRefs: [
      { label: 'Article 6', slug: 'article-6-high-risk-classification' },
      { label: 'Article 9', slug: 'article-9-risk-management' },
      { label: 'Article 10', slug: 'article-10-data-governance' },
      { label: 'Article 11', slug: 'article-11-technical-documentation' },
      // Chapter III Section 2 (same Annex III high-risk calendar as Arts 9–11).
      { label: 'Article 12', slug: 'article-12' },
      { label: 'Article 15', slug: 'article-15' },
      { label: 'Article 16', slug: 'article-16' },
      { label: 'Article 26 (Deployer)', slug: 'article-26-deployer-obligations' },
      { label: 'Article 27 (FRIA)', slug: 'article-27-fria' },
      { label: 'Article 49 (EU Database)', slug: 'article-49-eu-database' },
    ],
    timelineI18nKey: 'highRiskAnnexIii',
    countdownI18nKey: 'highRisk',
    showInCountdown: true,
    title: 'High-Risk System Requirements (Annex III)',
    description:
      'Full compliance required for high-risk AI systems listed in Annex III (standalone). Providers and deployers must meet Chapter III Section 2 obligations and related deployer, FRIA, and EU database duties. Date is unconditional under Regulation (EU) 2026/1744.',
    affectsRiskLevel: ['high'],
  },
  {
    id: 'high-risk-annex-i',
    date: '2028-08-02',
    articleRefs: [
      { label: 'Annex I', slug: 'annex-i' },
      { label: 'Annex II', slug: 'annex-ii' },
      { label: 'Article 6(1)' },
      { label: 'Article 8', slug: 'article-8' },
      { label: 'Article 43', slug: 'article-43' },
    ],
    timelineI18nKey: 'highRiskAnnexI',
    countdownI18nKey: 'fullEnforcement',
    showInCountdown: true,
    title: 'High-Risk Products (Annex I Embedded)',
    description:
      'Obligations extend to AI systems that are safety components of products covered by EU harmonisation legislation listed in Annex I (e.g., medical devices, machinery, vehicles, toys). Date is unconditional under Regulation (EU) 2026/1744.',
    affectsRiskLevel: ['high'],
  },
  {
    id: 'art-112-review-1',
    date: '2028-08-02',
    articleRefs: [{ label: 'Article 112', slug: 'article-112' }],
    timelineI18nKey: 'art112Review1',
    showInCountdown: false,
    title: 'Article 112 Review #1',
    description:
      'First Commission review under Article 112 of the AI Act.',
    affectsRiskLevel: ['all'],
  },
  {
    id: 'art-112-full-evaluation',
    date: '2029-08-02',
    articleRefs: [{ label: 'Article 112', slug: 'article-112' }],
    timelineI18nKey: 'art112FullEvaluation',
    showInCountdown: false,
    title: 'Article 112 Full Evaluation Report',
    description:
      'Commission full evaluation report under Article 112 of the AI Act.',
    affectsRiskLevel: ['all'],
  },
  {
    id: 'art-111-2-public-authorities',
    date: '2030-08-02',
    articleRefs: [{ label: 'Article 111(2)' }],
    timelineI18nKey: 'art1112PublicAuthorities',
    showInCountdown: false,
    title: 'High-Risk for Public Authorities (Art 111(2))',
    description:
      'High-risk AI systems intended to be used by public authorities must comply by this transitional deadline (Article 111(2)).',
    affectsRiskLevel: ['high'],
  },
  {
    id: 'annex-x-large-scale-it',
    date: '2030-12-31',
    articleRefs: [
      { label: 'Annex X', slug: 'annex-x' },
      { label: 'Article 111(1)', slug: 'article-111' },
      { label: 'Article 110', slug: 'article-110' },
    ],
    timelineI18nKey: 'annexXSystems',
    showInCountdown: false,
    title: 'Annex X Large-Scale EU IT Systems',
    description:
      'AI systems that are components of the large-scale IT systems listed in Annex X, placed on the market or put into service before 2 August 2027, must be brought into compliance by 31 December 2030 (Article 111(1)).',
    affectsRiskLevel: ['high'],
  },
  {
    id: 'art-111-2-legacy-high-risk',
    date: null,
    articleRefs: [{ label: 'Article 111(2)' }],
    timelineI18nKey: 'art1112LegacyHighRisk',
    showInCountdown: false,
    title: 'Legacy High-Risk Systems (Conditional)',
    description:
      'High-risk AI systems placed on the market before 2 August 2026 are in scope of the high-risk obligations only if they are subject to significant changes in their designs. This is a condition under Article 111(2), not a calendar deadline.',
    affectsRiskLevel: ['high'],
  },
] as const;

export const ENFORCEMENT_MILESTONES: readonly EnforcementMilestone[] =
  Object.freeze([...MILESTONE_LIST]);

export const ENFORCEMENT_MILESTONES_BY_ID: Readonly<
  Record<EnforcementMilestoneId, EnforcementMilestone>
> = Object.freeze(
  Object.fromEntries(MILESTONE_LIST.map((m) => [m.id, m])) as Record<
    EnforcementMilestoneId,
    EnforcementMilestone
  >,
);

/** Tier → applicable calendar deadline (ISO date or null). */
export const TIER_DEADLINES = Object.freeze({
  prohibited: ENFORCEMENT_MILESTONES_BY_ID['art-5-prohibited'].date!,
  high: ENFORCEMENT_MILESTONES_BY_ID['high-risk-annex-iii'].date!,
  limited: ENFORCEMENT_MILESTONES_BY_ID['art-50-transparency'].date!,
  minimal: null as string | null,
});

export function getMilestone(id: EnforcementMilestoneId): EnforcementMilestone {
  return ENFORCEMENT_MILESTONES_BY_ID[id];
}

/**
 * Corpus instruments (AI Act + amending Omnibus). Metadata about the legal text,
 * not obligation deadlines — do not fold these into MILESTONE_LIST / countdown.
 */
export const LEGAL_INSTRUMENTS = {
  'reg-2024-1689': {
    title: 'Regulation (EU) 2024/1689 (AI Act)',
    inForce: '2024-08-01',
  },
  'reg-2026-1744': {
    title: 'Regulation (EU) 2026/1744 (Digital Omnibus on AI)',
    ojPublished: '2026-07-24',
    inForce: '2026-07-27',
    amends: 'reg-2024-1689',
  },
} as const;

export type LegalInstrumentId = keyof typeof LEGAL_INSTRUMENTS;

export function getLegalInstrument(
  id: LegalInstrumentId,
): (typeof LEGAL_INSTRUMENTS)[LegalInstrumentId] {
  return LEGAL_INSTRUMENTS[id];
}

/**
 * Commission guidance interpreting a milestone's articles.
 *
 * Kept out of LEGAL_INSTRUMENTS deliberately: that map is the corpus — the
 * Regulation and what amends it. Guidelines interpret the Regulation without
 * changing it, and conflating the two would let a surface cite guidance as
 * though it were binding text.
 */
export interface InterpretiveGuidance {
  id: string;
  title: string;
  /** Milestone whose articles this guidance interprets. */
  milestone: EnforcementMilestoneId;
  /** ISO date the Commission adopted it. */
  adopted: string;
  sourceUrl: string;
  evidence: readonly string[];
}

export const INTERPRETIVE_GUIDANCE: readonly InterpretiveGuidance[] = Object.freeze([
  {
    id: 'ec-art-50-transparency-guidelines',
    title:
      'Commission Guidelines on the implementation of the transparency obligations for '
      + 'certain AI systems under Article 50 of the AI Act',
    milestone: 'art-50-transparency',
    adopted: '2026-07-20',
    sourceUrl:
      'https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems',
    evidence: ['ev_2026-08-08_b1_0001', 'ev_2026-08-08_a7_0006'],
  },
]);

/** Guidance interpreting a given milestone, newest adoption first. */
export function getGuidanceForMilestone(
  id: EnforcementMilestoneId,
): readonly InterpretiveGuidance[] {
  return INTERPRETIVE_GUIDANCE.filter((g) => g.milestone === id)
    .slice()
    .sort((a, b) => b.adopted.localeCompare(a.adopted));
}

/* -------------------------------------------------------------------------- */
/*  National implementation and competent authorities                          */
/* -------------------------------------------------------------------------- */

/**
 * WHO ENFORCES, as distinct from WHEN OBLIGATIONS APPLY.
 *
 * Everything above answers "from when". This answers "to whom do I answer",
 * which is a different question with a different shape: the milestones are
 * EU-wide and identical for everyone, while the authority depends on the member
 * state AND on the sector the deployer operates in.
 *
 * THE TRAP THIS STRUCTURE EXISTS TO AVOID. Germany does not have one AI Act
 * authority, it has three arrangements. A single answer of "Bundesnetzagentur"
 * is wrong for a bank (BaFin) and wrong for a broadcaster (the Land). A product
 * that answers "who regulates me" with one confident national name would be
 * giving a wrong answer to two whole sectors while looking entirely correct.
 *
 * So `sector` is part of the lookup, never an afterthought, and an unmapped
 * country returns nothing rather than a plausible default. See
 * `getCompetentAuthorities`.
 *
 * Deliberately NOT folded into MILESTONE_LIST: these carry no deadline and must
 * never reach the countdown.
 */

/**
 * Sector of the deployer, where that changes which authority is competent.
 * `general` means "no sectoral carve-out applies".
 */
export type DeployerSector = 'general' | 'financial_services' | 'media';

export type AuthorityRole =
  /** The authority a deployer in scope actually answers to. */
  | 'market_surveillance'
  /** Supports the authorities; a deployer does not report to it. */
  | 'coordination';

export interface CompetentAuthority {
  id: string;
  /** Official name, in the national language. */
  name: string;
  shortName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  role: AuthorityRole;
  /** Sectors for which this authority is competent. */
  sectors: readonly DeployerSector[];
  /** Plain-English rule, for surfaces that must explain the answer. */
  appliesWhen: string;
  sourceUrl: string;
  /** The sentence on `sourceUrl` that establishes the designation. */
  sourceQuote: string;
  /**
   * `high` — an auditor re-fetched the source and confirmed this quote verbatim.
   * `medium` — the designation holds, but some element was not reconfirmed
   * word-for-word on re-fetch, so surfaces should not state it flatly.
   */
  confidence: 'high' | 'medium';
  /** Evidence record ids in the agent store, for provenance. */
  evidence: readonly string[];
}

export interface NationalImplementation {
  country: string;
  /** National implementing law, in the national language. */
  law: string;
  shortName: string;
  /** ISO date the national law entered into force. */
  inForce: string;
  sourceUrl: string;
  sourceQuote: string;
  evidence: readonly string[];
  authorities: readonly CompetentAuthority[];
}

/**
 * Member states whose implementation has been evidenced.
 *
 * ONE ENTRY ONLY, ON PURPOSE. Germany is the single member state for which
 * primary sources have been fetched and audited. Every other state is absent
 * rather than guessed: "we have not mapped France" is a usable answer and
 * "probably the national market surveillance authority" is not.
 */
export const NATIONAL_IMPLEMENTATIONS: Readonly<Record<string, NationalImplementation>> =
  Object.freeze({
    DE: {
      country: 'DE',
      law: 'KI-Marktüberwachungs- und Innovationsförderungsgesetz (KI-MIG)',
      shortName: 'KI-MIG',
      inForce: '2026-07-29',
      sourceUrl: 'https://bmds.bund.de/aktuelles/pressemitteilungen/detail/neues-ki-gesetz-tritt-in-kraft',
      sourceQuote:
        'Heute tritt das KI-Marktüberwachungs-und-Innovationsförderungs-Gesetz (KI-MIG) in Kraft',
      evidence: ['ev_2026-08-08_b1_0002', 'ev_2026-08-08_a7_0007'],
      authorities: [
        {
          id: 'de-bnetza',
          name: 'Bundesnetzagentur',
          shortName: 'BNetzA',
          country: 'DE',
          role: 'market_surveillance',
          sectors: ['general'],
          appliesWhen:
            'Default federal market surveillance authority, complaint office and contact point '
            + 'for the AI Regulation, except where a Land designates its own authority or a '
            + 'sectoral supervisor is competent.',
          sourceUrl: 'https://bmds.bund.de/service/gesetzgebungsverfahren/gesetz-zur-durchfuehrung-der-ki-verordnung',
          sourceQuote:
            'wird die BNetzA zuständige Marktüberwachungsbehörde, soweit nicht die Länder die '
            + 'zuständigen Behörden bestimmen',
          confidence: 'high',
          evidence: ['ev_2026-08-08_b1_0004', 'ev_2026-08-08_a7_0065', 'ev_2026-08-08_a7_0007'],
        },
        {
          id: 'de-bafin',
          name: 'Bundesanstalt für Finanzdienstleistungsaufsicht',
          shortName: 'BaFin',
          country: 'DE',
          role: 'market_surveillance',
          sectors: ['financial_services'],
          appliesWhen:
            'Market surveillance for AI systems directly connected to a regulated financial '
            + 'activity, at companies in the financial sector.',
          sourceUrl: 'https://www.bafin.de/SharedDocs/Veroeffentlichungen/DE/Pressemitteilung/2026/pm_2026_07_29_ki_verordnung.html',
          sourceQuote: 'Die Bafin überwacht künftig KI-Systeme von Unternehmen des Finanzsektors.',
          confidence: 'high',
          evidence: ['ev_2026-08-09_b1_0001', 'ev_2026-08-09_a7_0001'],
        },
        {
          id: 'de-laender',
          name: 'Zuständige Landesbehörde',
          shortName: 'Land',
          country: 'DE',
          role: 'market_surveillance',
          sectors: ['media'],
          appliesWhen:
            'Where a Bundesland designates its own competent authority, that authority is '
            + 'competent instead of BNetzA. Media is the example given in the legislative '
            + 'materials. The specific body depends on the Land and is not named federally.',
          sourceUrl: 'https://bmds.bund.de/service/gesetzgebungsverfahren/gesetz-zur-durchfuehrung-der-ki-verordnung',
          sourceQuote:
            'wird die BNetzA zuständige Marktüberwachungsbehörde, soweit nicht die Länder die '
            + 'zuständigen Behörden bestimmen',
          // `medium`, not `high`: the audit (ev_2026-08-08_a7_0065) confirmed the clause above
          // verbatim but recorded that the trailing '(wie im Medienbereich)' parenthetical —
          // the part naming MEDIA specifically — was not independently reconfirmed on
          // re-fetch. The carve-out is established; media as its example is one source deep.
          confidence: 'medium',
          evidence: ['ev_2026-08-08_b1_0004', 'ev_2026-08-08_a7_0065'],
        },
        {
          id: 'de-kokivo',
          name: 'Koordinierungs- und Kompetenzzentrum für die KI-Verordnung',
          shortName: 'KoKIVO',
          country: 'DE',
          role: 'coordination',
          sectors: ['general', 'financial_services', 'media'],
          appliesWhen:
            'Service and advisory centre established at the Bundesnetzagentur, supporting '
            + 'federal and Länder market surveillance and notifying authorities. A deployer '
            + 'does not report to it.',
          sourceUrl: 'https://bmds.bund.de/service/gesetzgebungsverfahren/gesetz-zur-durchfuehrung-der-ki-verordnung',
          sourceQuote:
            'Bei der Bundesnetzagentur (BNetzA) wird daher ein Koordinierungs- und '
            + 'Kompetenzzentrum für die KI-Verordnung (KoKIVO) geschaffen',
          confidence: 'high',
          evidence: ['ev_2026-08-08_b1_0003', 'ev_2026-08-08_b1_0004', 'ev_2026-08-08_a7_0065'],
        },
      ],
    },
  });

/**
 * The authorities a deployer in `country` actually answers to, for `sector`.
 *
 * Returns `[]` for an unmapped country — the caller must render that as "not
 * mapped", never fall back to a neighbouring state's answer.
 *
 * Coordination bodies are excluded: KoKIVO supports the authorities and a
 * deployer does not report to it, so returning it alongside BNetzA would invite
 * a UI that lists two places to file the same notification. Use
 * `getSupportBodies` when you want it.
 */
export function getCompetentAuthorities(
  country: string,
  sector: DeployerSector = 'general',
): readonly CompetentAuthority[] {
  const impl = NATIONAL_IMPLEMENTATIONS[country.toUpperCase()];
  if (!impl) return [];
  return impl.authorities.filter(
    (a) => a.role === 'market_surveillance' && a.sectors.includes(sector),
  );
}

/** Coordination and advisory bodies for a country. Not who you report to. */
export function getSupportBodies(country: string): readonly CompetentAuthority[] {
  const impl = NATIONAL_IMPLEMENTATIONS[country.toUpperCase()];
  if (!impl) return [];
  return impl.authorities.filter((a) => a.role === 'coordination');
}

/** The national implementing law, or undefined when the state is unmapped. */
export function getNationalImplementation(country: string): NationalImplementation | undefined {
  return NATIONAL_IMPLEMENTATIONS[country.toUpperCase()];
}

/**
 * Calendar date when an article's obligations apply, derived only from milestone
 * articleRefs above (never a free-standing literal). Returns undefined when the
 * article is not listed on any dated milestone.
 *
 * Matching is by leading article number (`"9"`, `"50(2)"` → 50) so obligation
 * corpus ids like `"9"` resolve to the same milestone as `"Article 9"`.
 * When multiple milestones list the same number, the earliest dated one wins.
 */
export function getAppliesFromForArticle(article: string): string | undefined {
  const num = article.match(/^(\d+)/)?.[1];
  if (!num) return undefined;

  let best: string | undefined;
  for (const milestone of ENFORCEMENT_MILESTONES) {
    if (!milestone.date) continue;
    for (const ref of milestone.articleRefs) {
      const refNum = ref.label.match(/^Article\s+(\d+)/i)?.[1];
      if (refNum !== num) continue;
      if (!best || milestone.date < best) best = milestone.date;
    }
  }
  return best;
}

/**
 * Status relative to `now` (defaults to current instant).
 * Condition-only milestones (null date) always return `conditional`.
 * `upcoming` = not yet enforced but within six months.
 */
export function getStatus(
  id: EnforcementMilestoneId,
  now: Date = new Date(),
): EnforcementStatus {
  const milestone = ENFORCEMENT_MILESTONES_BY_ID[id];
  if (!milestone.date) return 'conditional';

  const date = new Date(`${milestone.date}T00:00:00.000Z`);
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setUTCMonth(sixMonthsFromNow.getUTCMonth() + 6);

  if (date.getTime() <= now.getTime()) return 'enforced';
  if (date.getTime() <= sixMonthsFromNow.getTime()) return 'upcoming';
  return 'future';
}

export function getCountdownMilestones(): readonly EnforcementMilestone[] {
  return ENFORCEMENT_MILESTONES.filter((m) => m.showInCountdown);
}
