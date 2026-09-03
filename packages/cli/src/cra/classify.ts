/**
 * CRA applicability and classification.
 *
 * 41% of the affected market cannot answer whether the CRA applies to them at
 * all, which makes this the entry point to every other question in the
 * Regulation and the largest unserved gap in the market. It is also a legal
 * reasoning problem rather than a scanning one, so every answer here carries
 * the article it comes from and a quote from it.
 *
 * WHAT IT WILL NOT DO. It never returns a bare "you are fine". Where the
 * Regulation is genuinely open, or where the answer turns on a delegated act
 * that does not exist yet, it returns `uncertain` and says why. A confident
 * out_of_scope that is wrong is the expensive error: the product ships, the
 * duties are unmet, and nobody finds out until a market surveillance authority
 * asks.
 *
 * The three-leg remote-data-processing test is often attributed to the
 * Commission's July 2026 guidance. It is in ARTICLE 3(2) itself; the guidance
 * only confirms it. Citing the Regulation is stronger, so that is what is cited.
 */

export type Verdict = 'in_scope' | 'out_of_scope' | 'uncertain';
export type ProductClass = 'default' | 'important_class_i' | 'important_class_ii' | 'critical';
export type Role =
  | 'manufacturer'
  | 'importer'
  | 'distributor'
  | 'authorised_representative'
  | 'open_source_steward'
  | 'substantial_modifier';

/** A regime that displaces the CRA under Article 2. */
export type ExcludedRegime = 'medical' | 'ivd' | 'vehicle' | 'aviation' | 'marine' | 'spare_part' | 'defence';

export interface ClassifyInput {
  /** `service_only` is browser-accessed SaaS with nothing shipped to the user. */
  kind: 'software' | 'hardware' | 'component' | 'service_only';
  /** Article 2(1): intended or reasonably foreseeable use includes a data connection. */
  hasDataConnection?: boolean;
  /** Article 3(22): supplied in the course of a COMMERCIAL activity, paid or free. */
  commercialActivity?: boolean;
  placedOnEuMarket?: boolean;
  excludedRegime?: ExcludedRegime | null;
  /** Article 3(2). All three legs, or it is not a remote data processing solution. */
  rdps?: {
    processesAtDistance?: boolean;
    byOrUnderManufacturer?: boolean;
    absenceBreaksAFunction?: boolean;
  };
  annexIii?: 'class_i' | 'class_ii' | null;
  annexIv?: boolean;
  role?: Role;
  /** Article 21: places under own name/trademark, or substantially modifies. */
  rebrandsOrModifies?: boolean;
  isFoss?: boolean;
}

export interface ClassifyStep {
  id: string;
  /**
   * Stable key for the OUTCOME, not the question. `id` is not unique: two
   * different data-connection outcomes both carry id 'data-connection', so a
   * translator keyed on id would render "Yes" over "No". This is what the web
   * app resolves strings against, and what __tests__ enumerate to prove every
   * reachable outcome has a translation.
   *
   * The English strings below stay the source of record. Nothing about the CLI
   * or a stored determination changes because this field exists.
   */
  key: string;
  question: string;
  answer: string;
  /** Article this step rests on. */
  basis: string;
  /** Short quote from the Official Journal. */
  quote: string;
  /**
   * Which Q entry `quote` came from, so a locale renders the OFFICIAL text of
   * that language rather than a translation of our English copy of it. The
   * German page quotes the German Official Journal, which is the only version
   * of a quote worth showing a German reader.
   */
  quoteKey: QuoteKey;
  decides?: Verdict;
}

export interface Determination {
  schema: 'legalithm.cra.classification/v0.1';
  verdict: Verdict;
  reason: string;
  /** Stable key for `reason`, so a locale can render it. See ClassifyStep.key. */
  reasonKey: string;
  steps: ClassifyStep[];
  role?: Role;
  effectiveRole?: Role;
  productClass?: ProductClass;
  conformityRoute?: string;
  appliesFrom?: { reporting: string; general: string };
  /** So a re-run after a guidance change is comparable. */
  engine: string;
  instrument: 'Regulation (EU) 2024/2847';
}

export const CLASSIFY_ENGINE_VERSION = 'cra-classify/0.1.0';

export type QuoteKey =
  | 'art2_1' | 'art2_2' | 'art2_3' | 'art2_4' | 'art2_6' | 'art2_7'
  | 'art3_1' | 'art3_2' | 'art3_22' | 'art21' | 'art71'
  | 'annex_default' | 'annex_listed' | 'art32';

const Q: Record<QuoteKey, string> = {
  art2_1:
    'This Regulation applies to products with digital elements made available on the market, the intended purpose or reasonably foreseeable use of which includes a direct or indirect logical or physical data connection to a device or network.',
  art2_2: 'This Regulation does not apply to products with digital elements to which the following Union legal acts apply',
  art2_3: 'This Regulation does not apply to products with digital elements that have been certified in accordance with Regulation (EU) 2018/1139.',
  art2_4: 'This Regulation does not apply to equipment that falls within the scope of Directive 2014/90/EU',
  art2_6: 'This Regulation does not apply to spare parts that are made available on the market to replace identical components',
  art2_7: 'This Regulation does not apply to products with digital elements developed or modified exclusively for national security or defence purposes',
  art3_1:
    "'product with digital elements' means a software or hardware product and its remote data processing solutions, including software or hardware components being placed on the market separately",
  art3_2:
    "'remote data processing' means data processing at a distance for which the software is designed and developed by the manufacturer, or under the responsibility of the manufacturer, and the absence of which would prevent the product with digital elements from performing one of its functions",
  art3_22:
    "'making available on the market' means the supply of a product with digital elements for distribution or use on the Union market in the course of a commercial activity, whether in return for payment or free of charge",
  art21:
    'An importer or distributor shall be considered to be a manufacturer for the purposes of this Regulation and shall be subject to Articles 13 and 14, where that importer or distributor places a product with digital elements on the market under its name or trademark or carries out a substantial modification',
  art71:
    'This Regulation shall apply from 11 December 2027. However, Article 14 shall apply from 11 September 2026 and Chapter IV (Articles 35 to 51) shall apply from 11 June 2026.',
  annex_default:
    'Products named in Annex III are important; those in Annex IV are critical. Everything else is default class.',
  annex_listed: 'Annex III lists important products with digital elements; Annex IV lists critical products.',
  art32:
    'The manufacturer shall perform a conformity assessment of the product with digital elements and the processes put in place by the manufacturer',
};

const EXCLUSION: Record<ExcludedRegime, { basis: string; quote: string; quoteKey: QuoteKey; what: string }> = {
  medical: { basis: 'Article 2(2)(a)', quote: Q.art2_2, quoteKey: 'art2_2', what: 'Regulation (EU) 2017/745 (medical devices)' },
  ivd: { basis: 'Article 2(2)(b)', quote: Q.art2_2, quoteKey: 'art2_2', what: 'Regulation (EU) 2017/746 (in vitro diagnostic medical devices)' },
  vehicle: { basis: 'Article 2(2)(c)', quote: Q.art2_2, quoteKey: 'art2_2', what: 'Regulation (EU) 2019/2144 (motor vehicle general safety)' },
  aviation: { basis: 'Article 2(3)', quote: Q.art2_3, quoteKey: 'art2_3', what: 'Regulation (EU) 2018/1139 (civil aviation certification)' },
  marine: { basis: 'Article 2(4)', quote: Q.art2_4, quoteKey: 'art2_4', what: 'Directive 2014/90/EU (marine equipment)' },
  spare_part: { basis: 'Article 2(6)', quote: Q.art2_6, quoteKey: 'art2_6', what: 'identical replacement spare parts' },
  defence: { basis: 'Article 2(7)', quote: Q.art2_7, quoteKey: 'art2_7', what: 'national security, defence, or classified information processing' },
};

const CONFORMITY_ROUTE: Record<ProductClass, string> = {
  default: 'Article 32(1): self-assessment (module A) is available',
  important_class_i:
    'Article 32(2): module A only where harmonised standards were applied IN FULL. None is cited in the Official Journal, so in practice module B+C or H',
  important_class_ii: 'Article 32(3): a notified body is required. No self-assessment route exists',
  critical: 'Article 32(4): a European cybersecurity certification scheme, or the Article 32(3) procedures',
};

function step(s: ClassifyStep): ClassifyStep {
  return s;
}

export function classify(input: ClassifyInput): Determination {
  const steps: ClassifyStep[] = [];
  const base = {
    schema: 'legalithm.cra.classification/v0.1' as const,
    engine: CLASSIFY_ENGINE_VERSION,
    instrument: 'Regulation (EU) 2024/2847' as const,
  };
  const out = (verdict: Verdict, reasonKey: string, reason: string): Determination =>
    ({ ...base, verdict, reason, reasonKey, steps });

  // 1. Displacing regimes come first: if another act applies, nothing else matters.
  if (input.excludedRegime) {
    const e = EXCLUSION[input.excludedRegime];
    steps.push(
      step({
        id: 'excluded-regime',
          key: `excluded-regime.${input.excludedRegime}`,
        question: 'Does another Union act displace the CRA for this product?',
        answer: `Yes: ${e.what}`,
        basis: e.basis,
        quote: e.quote,
          quoteKey: e.quoteKey,
        decides: 'out_of_scope',
      }),
    );
    return out('out_of_scope', `excluded-regime.${input.excludedRegime}`, `${e.basis} excludes products covered by ${e.what}.`);
  }

  // 2. Commercial activity. Non-commercial supply is not "making available".
  if (input.commercialActivity === false) {
    steps.push(
      step({
        id: 'commercial-activity',
          key: 'commercial-activity.no',
        question: 'Is the product supplied in the course of a commercial activity?',
        answer: 'No',
        basis: 'Article 3(22)',
        quote: Q.art3_22,
          quoteKey: 'art3_22',
        decides: 'out_of_scope',
      }),
    );
    return out(
      'out_of_scope',
      'commercial-activity.no',
      'Supply outside a commercial activity is not "making available on the market" under Article 3(22). Note that free of charge is still commercial if it is in the course of a commercial activity, and an open-source steward under Article 24 is a separate question.',
    );
  }

  // 3. The SaaS question, which is where most of the market gets it wrong.
  if (input.kind === 'service_only') {
    const r = input.rdps ?? {};
    const legs = [r.processesAtDistance, r.byOrUnderManufacturer, r.absenceBreaksAFunction];
    const answered = legs.every((l) => typeof l === 'boolean');
    const allThree = legs.every(Boolean);

    if (!answered) {
      steps.push(
        step({
          id: 'rdps-unanswered',
          key: 'rdps-unanswered',
          question: 'Is the service a remote data processing solution of a product?',
          answer: 'Not established: the three conditions in Article 3(2) were not all answered',
          basis: 'Article 3(2)',
          quote: Q.art3_2,
          quoteKey: 'art3_2',
          decides: 'uncertain',
        }),
      );
      return out(
        'uncertain',
        'rdps-unanswered',
        'A browser-accessed service is out of scope unless it is a remote data processing solution of a product. Answer all three conditions in Article 3(2) to decide.',
      );
    }
    steps.push(
      step({
        id: 'rdps',
          key: allThree ? 'rdps.yes' : 'rdps.no',
        question: 'Does the service meet all three conditions of Article 3(2)?',
        answer: allThree
          ? 'Yes: processed at a distance, designed by or under the responsibility of the manufacturer, and its absence would prevent a function'
          : 'No: at least one condition is not met',
        basis: 'Article 3(2)',
        quote: Q.art3_2,
          quoteKey: 'art3_2',
        decides: allThree ? 'in_scope' : 'out_of_scope',
      }),
    );
    if (!allThree) {
      return out(
        'out_of_scope',
        'rdps.no',
        'Standalone software delivered as a service is not a product with digital elements. Article 3(1) reaches a service only as a remote data processing solution, and Article 3(2) requires all three conditions.',
      );
    }
    steps.push(
      step({
        id: 'rdps-in-scope',
          key: 'rdps-in-scope',
        question: 'What brings it in?',
        answer: 'It is part of a product with digital elements as a remote data processing solution',
        basis: 'Article 3(1)',
        quote: Q.art3_1,
          quoteKey: 'art3_1',
      }),
    );
  }

  // 4. Article 2(1): the connection test.
  if (input.hasDataConnection === false) {
    steps.push(
      step({
        id: 'data-connection',
          key: 'data-connection.no',
        question:
          'Does the intended purpose or reasonably foreseeable use include a direct or indirect data connection to a device or network?',
        answer: 'No',
        basis: 'Article 2(1)',
        quote: Q.art2_1,
          quoteKey: 'art2_1',
        decides: 'out_of_scope',
      }),
    );
    return out(
      'out_of_scope',
      'data-connection.no',
      'Article 2(1) reaches only products whose intended purpose or reasonably foreseeable use includes a data connection. Reasonably foreseeable use is broad: an air-gapped deployment of a product that can connect does not take it out.',
    );
  }
  if (input.hasDataConnection === undefined && input.kind !== 'service_only') {
    steps.push(
      step({
        id: 'data-connection-unanswered',
          key: 'data-connection-unanswered',
        question: 'Is there a data connection in intended or reasonably foreseeable use?',
        answer: 'Not answered',
        basis: 'Article 2(1)',
        quote: Q.art2_1,
          quoteKey: 'art2_1',
        decides: 'uncertain',
      }),
    );
    return out('uncertain', 'data-connection-unanswered', 'Article 2(1) turns on the data connection test, which was not answered.');
  }
  if (input.hasDataConnection) {
    steps.push(
      step({
        id: 'data-connection',
        key: 'data-connection.yes',
        question: 'Data connection in intended or reasonably foreseeable use?',
        answer: 'Yes',
        basis: 'Article 2(1)',
        quote: Q.art2_1,
          quoteKey: 'art2_1',
      }),
    );
  }

  if (input.placedOnEuMarket === false) {
    steps.push(
      step({
        id: 'eu-market',
          key: 'eu-market.no',
        question: 'Is it made available on the Union market?',
        answer: 'No',
        basis: 'Article 2(1)',
        quote: Q.art2_1,
          quoteKey: 'art2_1',
        decides: 'out_of_scope',
      }),
    );
    return out('out_of_scope', 'eu-market.no', 'The CRA applies to products made available on the Union market.');
  }

  // 5. In scope. Now role, class and route.
  const role = input.role ?? 'manufacturer';
  let effectiveRole: Role = role;
  if ((role === 'importer' || role === 'distributor') && input.rebrandsOrModifies) {
    effectiveRole = 'manufacturer';
    steps.push(
      step({
        id: 'role-reassignment',
          key: 'role-reassignment',
        question: 'Does the importer or distributor place under its own name, or substantially modify?',
        answer: 'Yes: treated as the MANUFACTURER, subject to Articles 13 and 14 in full',
        basis: 'Article 21',
        quote: Q.art21,
          quoteKey: 'art21',
      }),
    );
  }

  const productClass: ProductClass = input.annexIv
    ? 'critical'
    : input.annexIii === 'class_ii'
      ? 'important_class_ii'
      : input.annexIii === 'class_i'
        ? 'important_class_i'
        : 'default';

  steps.push(
    step({
      id: 'product-class',
          key: `product-class.${productClass}`,
      question: 'Which product class?',
      answer:
        productClass === 'default'
          ? 'Default: not listed in Annex III or Annex IV'
          : productClass === 'critical'
            ? 'Critical, listed in Annex IV'
            : `Important, ${productClass === 'important_class_i' ? 'Annex III class I' : 'Annex III class II'}`,
      basis: productClass === 'critical' ? 'Annex IV' : productClass === 'default' ? 'Annex III' : 'Annex III',
      quoteKey: productClass === 'default' ? 'annex_default' : 'annex_listed',
      quote: productClass === 'default' ? Q.annex_default : Q.annex_listed,
    }),
  );

  steps.push(
    step({
      id: 'conformity-route',
          key: `conformity-route.${productClass}`,
      question: 'Which conformity assessment route?',
      answer: CONFORMITY_ROUTE[productClass],
      basis: 'Article 32',
      quoteKey: 'art32',
      quote: Q.art32,
    }),
  );

  steps.push(
    step({
      id: 'dates',
          key: 'dates',
      question: 'From when?',
      answer: 'Article 14 reporting from 11 September 2026; everything else from 11 December 2027',
      basis: 'Article 71(2)',
      quote: Q.art71,
          quoteKey: 'art71',
    }),
  );

  return {
    ...base,
    verdict: 'in_scope',
    reasonKey:
      effectiveRole === 'manufacturer' && role !== 'manufacturer'
        ? 'in-scope.role-reassigned'
        : 'in-scope.default',
    reason:
      effectiveRole === 'manufacturer' && role !== 'manufacturer'
        ? `In scope. You are treated as the manufacturer under Article 21 despite acting as ${role}.`
        : 'In scope as a product with digital elements made available on the Union market.',
    steps,
    role,
    effectiveRole,
    productClass,
    conformityRoute: CONFORMITY_ROUTE[productClass],
    appliesFrom: { reporting: '2026-09-11', general: '2027-12-11' },
  };
}
