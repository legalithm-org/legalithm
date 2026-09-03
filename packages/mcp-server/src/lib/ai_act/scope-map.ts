import {
  ENFORCEMENT_MILESTONES_BY_ID,
  type EnforcementMilestoneId,
} from './enforcement-dates';

/**
 * Per-feature Article 50 scope map.
 *
 * WHY THIS EXISTS. The assessment wizard answers "what is this system?" for one
 * free-text description and returns one risk tier. That is the wrong shape for
 * anybody who ships more than one thing. A hosting group, a platform or an
 * agency has dozens of features across dozens of brands, and the only question
 * that matters is per-feature: which limb of Article 50 attaches, to WHOM, and
 * from WHEN. Those three answers differ across features of the same product.
 *
 * THE THREE THINGS THIS MODELS THAT A RISK TIER CANNOT.
 *
 * 1. Article 50 has five distinct duties, not one. 50(1) and 50(2) bind the
 *    PROVIDER; 50(3) and 50(4) bind the DEPLOYER. A feature can trigger both
 *    sides at once, and marking under 50(2) does not discharge disclosure under
 *    50(4) even though both concern the same generated content.
 *
 * 2. Article 3(3) decides whether a provider duty lands on you or upstream. A
 *    system placed on the market under your own name or trademark makes you the
 *    provider regardless of who trained the model, and a provider duty cannot be
 *    contracted back upstream. This is the answer most often assumed rather than
 *    checked, so it is an explicit input, never inferred.
 *
 * 3. Article 111(4) gives 50(2) marking a grace period, and only that duty, and
 *    only for systems placed on the market before 2 August 2026. Everything else
 *    in Article 50 has applied since 2 August 2026 with no transition. Two dates
 *    that look like one date is the whole reason a map beats a checklist.
 *
 * NO REGULATORY TEXT IS WRITTEN IN THIS FILE. Duties and carve-outs are returned
 * as keys; the wording lives in i18n and the disclosure sentences live in
 * lib/ai_act/disclosure-corpus.yml. Dates are read from enforcement-dates.ts and
 * are never literals here. The one exception is ART_50_APPLIES_FROM below, which
 * is derived from a milestone rather than typed.
 *
 * PURE AND ISOMORPHIC ON PURPOSE. No fs, no async. The form recomputes the whole
 * map on every toggle in the browser, and the same function runs server-side for
 * tests and for any future export.
 *
 * Carve-outs are sourced from the Article 50 text reproduced in
 * content/ai-act-guide/article-50-transparency-obligations.json, which is the
 * consolidated OJ wording, not a summary of it.
 */

/** What a feature actually does. Drives which limb is in play. */
export type Capability =
  | 'interaction'
  | 'gen_text'
  | 'gen_image'
  | 'gen_audio'
  | 'gen_video'
  | 'emotion_biometric';

export const CAPABILITIES: readonly Capability[] = [
  'interaction',
  'gen_text',
  'gen_image',
  'gen_audio',
  'gen_video',
  'emotion_biometric',
] as const;

/** The synthetic-content capabilities, i.e. the ones Article 50(2) names. */
const SYNTHETIC: readonly Capability[] = ['gen_text', 'gen_image', 'gen_audio', 'gen_video'];

/** Article 50(4)(a) covers image, audio and video. Text is 50(4)(b). */
const DEEPFAKE_MEDIA: readonly Capability[] = ['gen_image', 'gen_audio', 'gen_video'];

export type Paragraph = '50(1)' | '50(2)' | '50(3)' | '50(4)(a)' | '50(4)(b)';

export type Role = 'provider' | 'deployer';

/**
 * Who carries the duty. The point of the map: a duty that is real but not yours
 * is still worth showing, because assuming it belongs to someone else is the
 * failure mode.
 */
export type Bearer = 'you' | 'upstream_provider' | 'downstream_deployer';

export type DutyKey =
  | 'interactionDisclosure'
  | 'machineReadableMarking'
  | 'emotionNotice'
  | 'deepFakeDisclosure'
  | 'publicInterestTextDisclosure';

export type CarveOutKey =
  | 'obviousFromContext'
  | 'assistiveEditing'
  | 'editorialControl'
  | 'noRelevantCapability';

export type LimitationKey = 'artisticWork';

export interface FeatureInput {
  id: string;
  product: string;
  feature: string;
  capabilities: Capability[];
  /** Article 3(3): placed on the market under your own name or trademark. */
  ownBrand: boolean;
  /** You also run it yourself, i.e. you are a deployer of it. */
  deploys: boolean;
  /** Article 111(4): placed on the market before 2 August 2026. */
  onMarketBefore2Aug2026: boolean;
  /** Article 50(2): assistive function for standard editing, or does not
   *  substantially alter the input data or its semantics. */
  assistiveEditingOnly: boolean;
  /** Article 50(1): obvious to a reasonably well-informed, observant and
   *  circumspect person, in the circumstances and context of use. */
  obviousFromContext: boolean;
  /** Article 50(4)(a): the generated image, audio or video constitutes a deep fake. */
  deepFake: boolean;
  /** Article 50(4)(a): part of an evidently artistic, creative, satirical or
   *  fictional work. Limits the manner of disclosure; it does not remove it. */
  artisticWork: boolean;
  /** Article 50(4)(b): text published to inform the public on matters of public interest. */
  publicInterestText: boolean;
  /** Article 50(4)(b): human review or editorial control, with a natural or legal
   *  person holding editorial responsibility. */
  editorialControl: boolean;
}

export interface Duty {
  paragraph: Paragraph;
  role: Role;
  bearer: Bearer;
  dutyKey: DutyKey;
  /** Key into disclosure-corpus long_form, where a sentence exists for the limb. */
  disclosureKey?: string;
  milestoneId: EnforcementMilestoneId;
  /** ISO date, read from the milestone. Never a literal. */
  appliesFrom: string;
  /** Present when the Regulation limits the manner of disclosure rather than removing it. */
  limitation?: LimitationKey;
}

export interface CarveOut {
  paragraph: Paragraph | null;
  key: CarveOutKey;
}

export interface FeatureResult {
  input: FeatureInput;
  duties: Duty[];
  carveOuts: CarveOut[];
  /** True when at least one duty attaches to anyone, you included. */
  inScope: boolean;
  /** True when at least one duty attaches to YOU. */
  yoursInScope: boolean;
}

const MILESTONE = {
  art50: 'art-50-transparency',
  preexistingSynthetic: 'art-111-4-preexisting-synthetic',
} as const satisfies Record<string, EnforcementMilestoneId>;

function milestoneDate(id: EnforcementMilestoneId): string {
  const date = ENFORCEMENT_MILESTONES_BY_ID[id].date;
  if (!date) throw new Error(`Milestone ${id} has no date; scope map cannot place it on a clock.`);
  return date;
}

/** Article 50 generally, i.e. everything except the 50(2) grace period. */
const ART_50_APPLIES_FROM = () => milestoneDate(MILESTONE.art50);

export function emptyFeature(id: string): FeatureInput {
  return {
    id,
    product: '',
    feature: '',
    capabilities: [],
    ownBrand: true,
    deploys: false,
    onMarketBefore2Aug2026: false,
    assistiveEditingOnly: false,
    obviousFromContext: false,
    deepFake: false,
    artisticWork: false,
    publicInterestText: false,
    editorialControl: false,
  };
}

/**
 * The Article 50(2) clock, and the only place the December line is decided.
 *
 * Article 111(4), as added by Regulation (EU) 2026/1744, moves marking to
 * 2 December 2026 for systems placed on the market before 2 August 2026. A system placed on the market after that date had no
 * transition at all, which is the counter-intuitive half: newer features are
 * late NOW, older ones are late in December.
 */
export function markingMilestone(onMarketBefore2Aug2026: boolean): EnforcementMilestoneId {
  return onMarketBefore2Aug2026 ? MILESTONE.preexistingSynthetic : MILESTONE.art50;
}

/** Resolve a feature against Article 50. Deterministic; no model involved. */
export function mapFeature(input: FeatureInput): FeatureResult {
  const duties: Duty[] = [];
  const carveOuts: CarveOut[] = [];
  const has = (c: Capability) => input.capabilities.includes(c);
  const hasAny = (cs: readonly Capability[]) => cs.some(has);

  const providerBearer: Bearer = input.ownBrand ? 'you' : 'upstream_provider';
  const deployerBearer: Bearer = input.deploys ? 'you' : 'downstream_deployer';

  // 50(1). Provider duty. Interaction with natural persons.
  if (has('interaction')) {
    if (input.obviousFromContext) {
      carveOuts.push({ paragraph: '50(1)', key: 'obviousFromContext' });
    } else {
      duties.push({
        paragraph: '50(1)',
        role: 'provider',
        bearer: providerBearer,
        dutyKey: 'interactionDisclosure',
        disclosureKey: 'chatbot',
        milestoneId: MILESTONE.art50,
        appliesFrom: ART_50_APPLIES_FROM(),
      });
    }
  }

  // 50(2). Provider duty. Machine-readable marking of synthetic output.
  // The one duty with a grace period, and only via Article 111(4).
  if (hasAny(SYNTHETIC)) {
    if (input.assistiveEditingOnly) {
      carveOuts.push({ paragraph: '50(2)', key: 'assistiveEditing' });
    } else {
      const milestoneId = markingMilestone(input.onMarketBefore2Aug2026);
      duties.push({
        paragraph: '50(2)',
        role: 'provider',
        bearer: providerBearer,
        dutyKey: 'machineReadableMarking',
        disclosureKey: 'genai-content',
        milestoneId,
        appliesFrom: milestoneDate(milestoneId),
      });
    }
  }

  // 50(3). Deployer duty. Emotion recognition or biometric categorisation.
  if (has('emotion_biometric')) {
    duties.push({
      paragraph: '50(3)',
      role: 'deployer',
      bearer: deployerBearer,
      dutyKey: 'emotionNotice',
      disclosureKey: 'emotion',
      milestoneId: MILESTONE.art50,
      appliesFrom: ART_50_APPLIES_FROM(),
    });
  }

  // 50(4)(a). Deployer duty. Deep fake image, audio or video.
  if (hasAny(DEEPFAKE_MEDIA) && input.deepFake) {
    const duty: Duty = {
      paragraph: '50(4)(a)',
      role: 'deployer',
      bearer: deployerBearer,
      dutyKey: 'deepFakeDisclosure',
      disclosureKey: 'deepfake',
      milestoneId: MILESTONE.art50,
      appliesFrom: ART_50_APPLIES_FROM(),
    };
    // An artistic work does not lose the duty, it narrows how it is discharged.
    if (input.artisticWork) duty.limitation = 'artisticWork';
    duties.push(duty);
  }

  // 50(4)(b). Deployer duty. AI-generated text informing the public on matters
  // of public interest. The limb most often missed, because the paragraph is
  // widely summarised as being about deep fakes.
  if (has('gen_text') && input.publicInterestText) {
    if (input.editorialControl) {
      carveOuts.push({ paragraph: '50(4)(b)', key: 'editorialControl' });
    } else {
      duties.push({
        paragraph: '50(4)(b)',
        role: 'deployer',
        bearer: deployerBearer,
        dutyKey: 'publicInterestTextDisclosure',
        milestoneId: MILESTONE.art50,
        appliesFrom: ART_50_APPLIES_FROM(),
      });
    }
  }

  if (input.capabilities.length === 0) {
    carveOuts.push({ paragraph: null, key: 'noRelevantCapability' });
  }

  return {
    input,
    duties,
    carveOuts,
    inScope: duties.length > 0,
    yoursInScope: duties.some((d) => d.bearer === 'you'),
  };
}

export interface ScopeSummary {
  features: number;
  products: number;
  /** Features with at least one duty on anyone. */
  inScope: number;
  /** Features with at least one duty on YOU. */
  yours: number;
  /** Features returning no duty at all. The out-of-scope list is the part that
   *  makes the in-scope list worth reading. */
  outOfScope: number;
  /** Duties on you already applicable at `asOf`. */
  liveNow: number;
  /** Duties on you not yet applicable at `asOf`. */
  upcoming: number;
  /** Nearest future applies-from among duties on you, ISO, or null. */
  nextDeadline: string | null;
  /** Whole days from `asOf` to nextDeadline, or null. */
  daysToNextDeadline: number | null;
}

const DAY_MS = 86_400_000;

/** Whole days between two ISO dates, UTC, so no timezone drift. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

/** `asOf` is injected rather than read from the clock so results are testable. */
export function summarise(results: FeatureResult[], asOf: string): ScopeSummary {
  const mine = results.flatMap((r) => r.duties.filter((d) => d.bearer === 'you'));
  const future = mine.map((d) => d.appliesFrom).filter((d) => daysBetween(asOf, d) > 0);
  const nextDeadline = future.length ? future.sort()[0]! : null;

  return {
    features: results.length,
    products: new Set(results.map((r) => r.input.product.trim().toLowerCase()).filter(Boolean)).size,
    inScope: results.filter((r) => r.inScope).length,
    yours: results.filter((r) => r.yoursInScope).length,
    outOfScope: results.filter((r) => !r.inScope).length,
    liveNow: mine.filter((d) => daysBetween(asOf, d.appliesFrom) <= 0).length,
    upcoming: mine.filter((d) => daysBetween(asOf, d.appliesFrom) > 0).length,
    nextDeadline,
    daysToNextDeadline: nextDeadline ? daysBetween(asOf, nextDeadline) : null,
  };
}

export function mapEstate(features: FeatureInput[]): FeatureResult[] {
  return features.map(mapFeature);
}
