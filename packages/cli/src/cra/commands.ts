/**
 * CRA v0.1: four commands over the append-only store.
 *
 *   product   register a product version, the unit every CRA duty attaches to
 *   ingest    record what is in it, from a build or from a named human
 *   watch     join that against actively-exploited vulnerabilities, start the clock
 *   simulate  run the same clock engine on a hypothetical, marked as a simulation
 *
 * THE AWARENESS INVARIANT, which is the one rule of this file most easily lost:
 *
 *   Legalithm NEVER infers legal awareness from execution time. A real reporting
 *   clock requires an explicitly declared awareness timestamp, or an explicit
 *   affirmation that awareness is now.
 *
 * `dueAt` used to be computed from when the command ran. A team aware on Tuesday
 * at 10:15 that scanned on Thursday at 14:00 was told the early warning was due
 * Friday at 14:00; it was due Wednesday at 10:15, already two days gone. Wrong in
 * the direction that tells a manufacturer they have more time. Fifty-two callers
 * across fourteen test files were relying on that default, which is how invisible
 * it was.
 *   record    emit a dated, signable decision record
 *
 * THE ONE RULE THIS FILE ENFORCES: a machine writes hypotheses, a named human
 * writes claims. `watch` can never produce a claim, whatever it finds, and
 * `ingest --declare` cannot run without a signer. Conformity stays with the
 * manufacturer; this tool assembles the evidence and records who asserted what.
 *
 * LOCAL-FIRST, precisely. The KEV catalogue is public data and may be fetched.
 * The join of your SBOM against it is the sensitive artifact, because it is a
 * map of how to attack your product, and it never leaves this machine. Nothing
 * here uploads anything.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';

import { append, asOf, readStream, contentHash, CRA_DIR, type StoreEvent } from './store.js';
import { VERSION, TOOL_ID } from '../version.js';
import { loadSigningKey, signRecordHash, publicKeyPemFor } from '../record-signing.js';
import { verifyDetachedSignature, registerVerificationKey } from '../record-signature.js';
import {
  ATTESTATION_VERDICTS,
  attestationHash,
  buildAttestationBody,
  buildRequest,
  checkAttestation,
  sourceIdentity,
  contactFromManifest,
  summariseRequests,
  type AttestationRequest,
  type AttestationVerdict,
  type RequestBody,
  type SignedAttestation,
  type SupplierContact,
} from './supplier.js';
import {
  assessCve,
  loadSymbolMap,
  defaultAnalyserPath,
  llvmAnalyser,
  type ReachabilityVerdict,
} from './reachability/index.js';
import { classify, type ClassifyInput, type Determination, type Role } from './classify.js';
import { generateDocument, renderDocumentMarkdown, renderDocumentHtml, type DocumentFacts } from './documents.js';
import { htmlToPdf } from './to-pdf.js';
import { supportStatus, supportExitCode, type SupportPeriod } from './support.js';
import {
  buildUserAdvisory,
  renderAdvisoryMarkdown,
  advisoryEnvelope,
  type AdvisoryTrigger,
} from './advisory.js';
import { dutiesFor, type CraRole } from './duties.js';
import {
  buildArticle14Report,
  renderArticle14Markdown,
  reportEnvelope,
  type ReportStage,
  type ReportTrack,
} from './article14.js';
import { loadEpss, fetchEpss, loadOsv, matchOsv, prioritise, type EpssScore } from './intel.js';
import {
  annexIRequirements,
  buildAnnexIReport,
  annexIComplete,
  isAnnexIRef,
  type AnnexIClaim,
  type RequirementStatus,
} from './assess.js';

export interface CraIo {
  cwd: string;
  log: (message: string) => void;
  error: (message: string) => void;
  now?: () => Date;
  /** Injected so tests never touch the network. */
  fetchKev?: () => Promise<KevCatalogue>;
  /** Injected so tests never shell out to python. */
  assessCve?: (cve: string) => ReachabilityVerdict;
  /** Injected so a test never spawns a browser. */
  htmlToPdf?: (html: string, pdf: string) => { ok: boolean; converter?: string; degraded?: boolean; reason?: string };
}

/**
 * The CISA catalogue, modelled as CISA actually publishes it.
 *
 * The previous type carried only `cveID`, `vulnerabilityName` and `dateAdded`,
 * so `vulnerabilityName` was the only descriptive string the code had, and it
 * got used for component matching because it was there. It is a free-text
 * human description and matching against it produced false negatives on real
 * data.
 *
 * `vendorProject` and `product` are modelled here because they exist and
 * omitting them is how that happened. They still MUST NOT be matched against
 * SBOM component names: KEV names the shipping product ("Chromium WebP") and
 * an SBOM names the library ("libwebp"). Only `cveID` is join-safe.
 */
export interface KevCatalogue {
  catalogVersion?: string;
  vulnerabilities: {
    /** The ONLY field safe to join on. */
    cveID: string;
    /** Descriptive. Never match component names against these three. */
    vendorProject?: string;
    product?: string;
    vulnerabilityName?: string;
    dateAdded?: string;
  }[];
}

export interface ProductBody extends Record<string, unknown> {
  name: string;
  version: string;
  productClass: 'default' | 'important_class_i' | 'important_class_ii' | 'critical';
  supportUntil?: string;
  /**
   * Set when this is OUR ANALYSIS OF SOMEONE ELSE'S PRODUCT.
   *
   * Every CRA obligation lands on an economic operator. Analysing a product you
   * did not make gives you no duty to notify ENISA about it and no standing to
   * declare its conformity: both belong to its manufacturer. A record unable to
   * tell the two apart produces something that READS as a conformity record for
   * a product its author has no relationship to.
   *
   * Found by running this pipeline over curl 8.11.1, which produced three
   * Article 14 clocks against a product we do not make.
   */
  analysisOnly?: boolean;
  /** Who the product actually belongs to. Required when analysisOnly is set. */
  manufacturer?: string;
}

const PRODUCT_CLASSES: ProductBody['productClass'][] = [
  'default',
  'important_class_i',
  'important_class_ii',
  'critical',
];

/** Article 32 routes a product to a module by class. */
const CONFORMITY_ROUTE: Record<ProductBody['productClass'], string> = {
  default: 'Article 32(1): self-assessment (module A) available',
  important_class_i:
    'Article 32(2): module A only where harmonised standards are applied IN FULL. None is cited in the OJ, so in practice module B+C or H',
  important_class_ii: 'Article 32(3): notified body required. No self-assessment route exists',
  critical: 'Article 32(4): European cybersecurity certification scheme, or the 32(3) procedures',
};

/** Article 71(2): the Regulation applies from 11 Dec 2027, Article 14 from 11 Sept 2026. */
export const CRA_REPORTING_APPLIES_FROM = '2026-09-11';
export const CRA_GENERAL_APPLICATION = '2027-12-11';

function productKey(p: ProductBody): string {
  return contentHash({ name: p.name, version: p.version });
}

/**
 * Resolve --product to exactly one registered product.
 *
 * The flag used to mean two different things. `cra ingest` matched a prefix of
 * the content-addressed KEY, so `--product "Legalithm CLI"` could never match
 * and failed with "No product matching", for a product that was registered
 * seconds earlier. `cra watch` matched a prefix of the NAME. One flag, two
 * readings, and the readable one was the one that did not work.
 *
 * Now both accept either: a key prefix, or the name, or `name@version`.
 *
 * AN AMBIGUOUS NAME IS AN ERROR, NOT A GUESS. The CRA's unit of obligation is
 * the product VERSION, so silently picking the newest of two matching versions
 * would attach evidence, findings and Article 14 clocks to the wrong subject.
 * Candidates are listed instead.
 */
export function resolveProduct(
  products: StoreEvent<ProductBody>[],
  query: string | undefined,
): { product: StoreEvent<ProductBody> } | { error: string } {
  if (!query) {
    const last = products[products.length - 1];
    return last ? { product: last } : { error: 'No product registered.' };
  }
  const q = query.toLowerCase();
  const byKey = products.filter((p) => productKey(p.body).startsWith(query));
  if (byKey.length === 1) return { product: byKey[0]! };

  const matches = products.filter((p) => {
    const name = p.body.name.toLowerCase();
    return name === q || `${name}@${p.body.version.toLowerCase()}` === q;
  });
  if (matches.length === 1) return { product: matches[0]! };
  if (matches.length > 1) {
    const list = matches
      .map((p) => `  ${productKey(p.body).slice(0, 16)}  ${p.body.name} ${p.body.version}`)
      .join('\n');
    return {
      error:
        `"${query}" matches ${matches.length} registered versions, and the CRA's unit of ` +
        `obligation is the product version. Name one:\n${list}\n` +
        `Use --product "${matches[0]!.body.name}@${matches[0]!.body.version}" or a key prefix.`,
    };
  }
  if (byKey.length > 1) {
    return { error: `Key prefix "${query}" is ambiguous across ${byKey.length} products. Use more characters.` };
  }

  const known = products.map((p) => `  ${productKey(p.body).slice(0, 16)}  ${p.body.name} ${p.body.version}`).join('\n');
  return { error: `No product matching "${query}". Registered:\n${known}` };
}


// ---------------------------------------------------------------- product ---

export function craProduct(
  io: CraIo,
  opts: {
    name?: string;
    version?: string;
    productClass?: string;
    supportUntil?: string;
    json?: boolean;
    thirdParty?: boolean;
    manufacturer?: string;
  },
): number {
  if (!opts.name || !opts.version) {
    io.error('Usage: legalithm cra product --name <name> --version <version> [--class <class>]');
    io.error('  --third-party --manufacturer "<who makes it>"   analysis of another party\'s product');
    return 1;
  }
  if (opts.thirdParty && !opts.manufacturer) {
    io.error('--third-party needs --manufacturer "<who actually makes it>".');
    io.error("An analysis of an unnamed party's product is attributable to nobody.");
    return 1;
  }
  const productClass = (opts.productClass ?? 'default') as ProductBody['productClass'];
  if (!PRODUCT_CLASSES.includes(productClass)) {
    io.error(`Unknown --class "${opts.productClass}". One of: ${PRODUCT_CLASSES.join(', ')}`);
    return 1;
  }

  const body: ProductBody = {
    name: opts.name,
    version: opts.version,
    productClass,
    ...(opts.supportUntil ? { supportUntil: opts.supportUntil } : {}),
    ...(opts.thirdParty ? { analysisOnly: true, manufacturer: opts.manufacturer } : {}),
  };
  const { event, created } = append(io.cwd, 'products', body, { now: io.now });
  const key = productKey(body);

  if (opts.json) {
    io.log(JSON.stringify({ product: key, event: event.id, created, route: CONFORMITY_ROUTE[productClass] }, null, 2));
    return 0;
  }
  io.log(created ? `Registered ${body.name} ${body.version}` : `Already registered: ${body.name} ${body.version}`);
  io.log(`  product   ${key.slice(0, 16)}`);
  io.log(`  class     ${productClass}`);
  if (body.analysisOnly) {
    // Route and support period are the MANUFACTURER's concerns. Printing them
    // would prompt an analyst to commit to a support period they cannot offer.
    io.log(`  ANALYSIS ONLY. Made by ${body.manufacturer}, not by you.`);
    io.log('  No Article 14 clock starts and no conformity document can be generated:');
    io.log("  both are the manufacturer's. Findings still stand as analysis.");
    return 0;
  }
  io.log(`  route     ${CONFORMITY_ROUTE[productClass]}`);
  if (!body.supportUntil) {
    io.log(
      '  support   NOT SET. Article 13(8) requires one: at least five years, OR the expected ' +
        'use time where that is shorter. Annex II (7) requires telling the user its end ' +
        'date. Record it with: legalithm cra support --until <date> --by <name> --rationale <why>',
    );
  }
  return 0;
}

// ----------------------------------------------------------------- ingest ---

export interface EvidenceBody extends Record<string, unknown> {
  product: string;
  component: string;
  /**
   * The component version, as a field.
   *
   * It was recovered from the assertion with `assertion.split(' ').pop()`, so
   * the OSV join depended on the last word of a human sentence. Rewording the
   * assertion for binary-analysis rows silently broke every version match: the
   * extracted "version" became the word "analysis" and nothing hit.
   *
   * Optional because rows written before this field exist; the old parse is the
   * fallback for those and nothing else.
   */
  version?: string;
  assertion: string;
  sourceType: 'build' | 'attestation' | 'analysis';
  sourceIdentity: string;
  confidence: 'exact' | 'asserted' | string;
}

/**
 * The component slot for an SBOM that legitimately lists nothing.
 *
 * "This product has no third-party components" and "no SBOM was ever ingested"
 * are opposite states, and they used to be indistinguishable: an empty SBOM
 * produced zero evidence rows, so `cra watch` refused with "No evidence
 * ingested. Run: legalithm cra ingest --sbom <path>" after the SBOM had in fact
 * been ingested. A product with no dependencies could not produce a record at
 * all, which is backwards. Having nothing to declare is the position Annex I
 * Part II rewards, and it is a result worth recording rather than a gap.
 *
 * Deliberately not shaped like a package name. It is filtered out before the
 * OSV join so it can never match an advisory, and it reads correctly to a human
 * scanning the evidence stream.
 */
export const NO_COMPONENTS = '(no third-party components)';

/**
 * A CycloneDX component's `name` is NOT the package name for a scoped package.
 *
 * CycloneDX splits an npm scope into `group` and `name`, so `@babel/runtime` is
 * stored as `{ group: "@babel", name: "runtime" }`. Reading `name` alone yielded
 * `runtime`, `cli`, `types` and `node`, which breaks the OSV join in both
 * directions: no advisory for `@babel/runtime` can ever match `runtime`, which
 * is a vulnerability the user is told they do not have, and a bare `cli` or
 * `node` can match an unrelated package that really is called that.
 *
 * The purl is authoritative and unambiguous, so it wins when present:
 * `pkg:npm/%40changesets/cli@2.31.1` decodes to `@changesets/cli`. `group` is
 * only used as a fallback, and only when it looks like an npm scope, because in
 * Maven `group` is a groupId and `group/name` would be wrong there.
 */
function componentName(c: { name?: string; group?: string; purl?: string }): string {
  const purl = typeof c.purl === 'string' ? c.purl : '';
  const npm = /^pkg:npm\/(.+?)@[^@]*$/.exec(purl) ?? /^pkg:npm\/(.+)$/.exec(purl);
  if (npm?.[1]) return decodeURIComponent(npm[1]);
  const group = typeof c.group === 'string' ? c.group : '';
  if (group.startsWith('@')) return `${group}/${String(c.name)}`;
  return String(c.name);
}

/**
 * How a component in an SBOM came to be listed.
 *
 * Decision 3: "binary analysis by INGESTION only". A firmware scanner from
 * ONEKEY, Finite State or cve-bin-tool emits a CycloneDX SBOM like any other,
 * and the components in it are NOT the same kind of fact as the ones in a build
 * SBOM. A build SBOM says "I compiled this in". A binary analysis says "a tool
 * matched a fingerprint and thinks this is probably in there".
 *
 * Everything was recorded as `sourceType: 'build'`, `confidence: 'exact'`, so a
 * 0.6-confidence fingerprint guess entered the record as a fact about what the
 * product contains. The architecture's evidence primitive has always said
 * `confidence: exact | fingerprint 0.87 | asserted`; the code never implemented
 * the middle one.
 *
 * CycloneDX 1.5 carries this natively in `components[].evidence.identity`:
 * a confidence 0..1 and the techniques used. That is read rather than guessed,
 * and `--analysis` covers scanners that emit no evidence block.
 */
interface ComponentIdentity {
  /** 0..1 from the SBOM, or null when it does not say. */
  confidence: number | null;
  /** e.g. binary-analysis, hash-comparison, filename. */
  techniques: string[];
}

/** Techniques that mean "inferred from a binary", not "known from a build". */
const INFERRED_TECHNIQUES = new Set([
  'binary-analysis',
  'filename',
  'hash-comparison',
  'ast-fingerprint',
  'dynamic-analysis',
  'instrumentation',
]);

function identityOf(c: Record<string, unknown>): ComponentIdentity {
  const ev = (c.evidence ?? {}) as { identity?: unknown };
  // 1.5 allows identity to be an object or an array of them.
  const ids = Array.isArray(ev.identity) ? ev.identity : ev.identity ? [ev.identity] : [];
  let confidence: number | null = null;
  const techniques: string[] = [];
  for (const raw of ids) {
    const id = raw as { confidence?: unknown; methods?: unknown };
    if (typeof id.confidence === 'number') {
      // Lowest wins: the weakest identification is what the row is worth.
      confidence = confidence === null ? id.confidence : Math.min(confidence, id.confidence);
    }
    for (const m of (Array.isArray(id.methods) ? id.methods : []) as { technique?: unknown }[]) {
      if (typeof m.technique === 'string') techniques.push(m.technique);
    }
  }
  return { confidence, techniques };
}

/** The analyser that produced the SBOM, from CycloneDX metadata.tools. */
export function sbomToolName(doc: Record<string, unknown>): string | null {
  const meta = (doc.metadata ?? {}) as { tools?: unknown };
  const t = meta.tools as { components?: unknown[] } | unknown[] | undefined;
  const list = Array.isArray(t) ? t : Array.isArray(t?.components) ? t.components : [];
  const named = list
    .map((x) => x as { name?: unknown; version?: unknown; vendor?: unknown })
    .filter((x) => typeof x.name === 'string')
    // npm and cyclonedx-npm are how the SBOM was rendered, not what analysed the
    // firmware. Naming them as the analyser would misattribute the evidence.
    .filter((x) => !['npm', 'cyclonedx-npm'].includes(String(x.name)));
  const first = named[0];
  if (!first) return null;
  return [first.vendor, first.name, first.version].filter(Boolean).join(' ').trim() || null;
}

/** CycloneDX and SPDX, the two formats Annex I Part II (1) is satisfied with. */
function parseSbom(raw: string): { component: string; version: string; identity: ComponentIdentity }[] {
  const doc = JSON.parse(raw) as Record<string, unknown>;
  const cdx = doc.components as Record<string, unknown>[] | undefined;
  if (Array.isArray(cdx)) {
    return cdx
      .filter((c) => c?.name)
      .map((c) => ({
        component: componentName(c as { name?: string; group?: string; purl?: string }),
        version: String(c.version ?? 'unknown'),
        identity: identityOf(c),
      }));
  }
  const spdx = doc.packages as { name?: string; versionInfo?: string }[] | undefined;
  if (Array.isArray(spdx)) {
    // SPDX carries no equivalent of CycloneDX identity evidence, so nothing is
    // inferred: an SPDX row says what it says and no more.
    return spdx
      .filter((p) => p?.name)
      .map((p) => ({
        component: String(p.name),
        version: String(p.versionInfo ?? 'unknown'),
        identity: { confidence: null, techniques: [] },
      }));
  }
  throw new Error('Unrecognised SBOM: expected CycloneDX "components" or SPDX "packages".');
}

export function craIngest(
  io: CraIo,
  opts: { sbom?: string; analysis?: boolean; declare?: string; attestation?: string; product?: string; by?: string; observedAt?: string; json?: boolean },
): number {
  const products = asOf(readStream<ProductBody>(io.cwd, 'products'));
  if (products.length === 0) {
    io.error('No product registered. Run: legalithm cra product --name <name> --version <version>');
    return 1;
  }
  const resolved = resolveProduct(products, opts.product);
  if ('error' in resolved) {
    io.error(resolved.error);
    return 1;
  }
  const product = productKey(resolved.product.body);

  let rows: EvidenceBody[] = [];
  if (opts.sbom) {
    if (!existsSync(opts.sbom)) {
      io.error(`No SBOM at ${opts.sbom}`);
      return 1;
    }
    let parsed;
    try {
      parsed = parseSbom(readFileSync(opts.sbom, 'utf8'));
    } catch (e) {
      io.error((e as Error).message);
      return 1;
    }
    // An SBOM that parses and lists nothing is a statement, not a no-op. Record
    // it, or the ingest leaves no trace and `cra watch` later reports that no
    // SBOM was ever supplied. See NO_COMPONENTS.
    if (parsed.length === 0) {
      parsed = [{ component: NO_COMPONENTS, version: '', identity: { confidence: null, techniques: [] } }];
    }
    /*
     * A binary analysis is not a build.
     *
     * If any component carries an inferred identification technique, or the
     * caller passed --analysis, this SBOM describes what a tool THINKS is in the
     * artifact. Recording that as an exact build fact is the wrong-direction
     * error: it turns a fingerprint guess into a statement about what the
     * product contains.
     */
    const doc = JSON.parse(readFileSync(opts.sbom, 'utf8')) as Record<string, unknown>;
    const inferred = parsed.some((c) => c.identity.techniques.some((t) => INFERRED_TECHNIQUES.has(t)));
    const isAnalysis = Boolean(opts.analysis) || inferred;
    const analyser = sbomToolName(doc);
    const sourceIdentity = isAnalysis
      ? (opts.by ?? analyser ?? `analysis:${opts.sbom}`)
      : (opts.by ?? `sbom:${opts.sbom}`);

    rows = parsed.map((c) => ({
      product,
      component: c.component,
      ...(c.component === NO_COMPONENTS ? {} : { version: c.version }),
      assertion:
        c.component === NO_COMPONENTS
          ? 'contains no third-party components'
          : isAnalysis
            ? `probably contains ${c.component} ${c.version}, identified by analysis`
            : `contains ${c.component} ${c.version}`,
      sourceType: isAnalysis ? 'analysis' : 'build',
      sourceIdentity,
      // `fingerprint 0.87` is the vocabulary the architecture specified. A scan
      // that reports no confidence is `asserted`, never `exact`.
      confidence:
        c.component === NO_COMPONENTS || !isAnalysis
          ? 'exact'
          : c.identity.confidence !== null
            ? `fingerprint ${c.identity.confidence}`
            : 'asserted',
      ...(isAnalysis && c.identity.techniques.length
        ? { identifiedBy: [...new Set(c.identity.techniques)].sort() }
        : {}),
    }));
  } else if (opts.declare) {
    // A declaration is a person putting their name to something. Without a
    // name it is an anonymous assertion, which is not evidence.
    if (!opts.by) {
      io.error('A declaration needs a signer: --by "Name <email>". An unattributed assertion is not evidence.');
      return 1;
    }
    rows = [
      {
        product,
        component: 'declared',
        assertion: opts.declare,
        sourceType: 'attestation',
        sourceIdentity: opts.by,
        confidence: 'asserted',
      },
    ];
  } else if (opts.attestation) {
    /*
     * A supplier's signed answer becomes EVIDENCE, never a claim.
     *
     * "The supplier said not_affected" is a fact about what the supplier said.
     * Promoting it straight to the manufacturer's own position would launder
     * somebody else's word into your conformity claim, and the supplier does not
     * carry your Article 13 obligations. A named human here still has to decide.
     */
    if (!existsSync(opts.attestation)) {
      io.error(`No attestation at ${opts.attestation}`);
      return 1;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(opts.attestation, 'utf8'));
    } catch (e) {
      io.error(`Could not read the attestation: ${(e as Error).message}`);
      return 1;
    }
    const checked = checkAttestation(parsed, verifyAttestationSignature);
    if (!checked.ok) {
      io.error(`Refusing to ingest: ${checked.reason}`);
      io.error('An attestation that does not verify is not evidence of anything.');
      return 1;
    }
    const b = checked.body;
    rows = [
      {
        product,
        component: b.component,
        assertion: `${b.organisation} states ${b.component} ${b.componentVersion} is ${b.verdict} for ${b.cve}: ${b.rationale}`,
        sourceType: 'attestation',
        sourceIdentity: sourceIdentity(b),
        confidence: 'asserted',
        attestation: {
          cve: b.cve,
          verdict: b.verdict,
          declaredBy: b.declaredBy,
          organisation: b.organisation,
          declaredAt: b.declaredAt,
          keyId: checked.keyId,
          attestationHash: attestationHash(b),
        },
      } as EvidenceBody,
    ];
    io.log(`Verified attestation from ${sourceIdentity(b)} under key "${checked.keyId}".`);
    io.log('This proves possession of that key, not who holds it. Confirm the key');
    io.log('with the supplier out of band before relying on the name.');
    io.log('');
    io.log('Recorded as EVIDENCE. It is not your claim: a named person here still');
    io.log('has to decide, with: legalithm cra claim --cve ' + b.cve + ' --verdict <...> --by "<name>"');
  } else {
    io.error('Usage: legalithm cra ingest --sbom <path> | --declare "<statement>" --by "<name>" | --attestation <path>');
    return 1;
  }

  let created = 0;
  for (const body of rows) {
    const r = append(io.cwd, 'evidence', body, { observedAt: opts.observedAt, now: io.now });
    if (r.created) created += 1;
  }

  if (opts.json) {
    io.log(JSON.stringify({ product, ingested: rows.length, created }, null, 2));
    return 0;
  }
  io.log(`Ingested ${rows.length} evidence claim(s) for ${resolved.product.body.name} ${resolved.product.body.version}`);
  if (rows.some((r) => r.sourceType === 'analysis')) {
    const scored = rows.filter((r) => String(r.confidence).startsWith('fingerprint')).length;
    io.log(`  source    ANALYSIS, not a build: ${rows[0]?.sourceIdentity ?? 'unknown analyser'}`);
    io.log(`  ${scored} of ${rows.length} carry a confidence score from the analyser.`);
    io.log('  These are components a tool believes are present. That is a weaker fact');
    io.log('  than a build manifest, and findings against them inherit the doubt.');
  }
  io.log(`  new       ${created}`);
  io.log(`  duplicate ${rows.length - created} (identical evidence is idempotent)`);
  return 0;
}

// ------------------------------------------------------------------ watch ---

const KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

async function defaultFetchKev(): Promise<KevCatalogue> {
  const res = await fetch(KEV_URL);
  if (!res.ok) throw new Error(`KEV fetch failed: HTTP ${res.status}`);
  return (await res.json()) as KevCatalogue;
}

/**
 * Who or what produced a hypothesis.
 *
 * Decision 6 lets AI write to the hypothesis table and never to the claim table,
 * and requires the model, the prompt version and the date to be stored with
 * every hypothesis. The type boundary was enforced from the start; this is the
 * provenance half, built deliberately BEFORE any model writes anything. Adding
 * it afterwards would leave a window of machine output that cannot be
 * attributed, inside a record whose entire purpose is attribution.
 *
 * `model` and `promptVersion` are `null` rather than absent when the hypothesis
 * is deterministic, because "produced by a rule" and "nobody recorded what
 * produced this" must not read the same. That distinction is the point of the
 * field: a reader in 2031 has to be able to tell a join from a judgement.
 *
 * There is no date here, on purpose. The store envelope already carries
 * `observedAt` and `recordedAt`; a third timestamp would be a second answer to
 * the same question. The format spec says which to read.
 */
export interface HypothesisProvenance extends Record<string, unknown> {
  /** Stable id of the producing software, e.g. `legalithm-cli`. */
  tool: string;
  /** The exact build, so a finding traces to the code that made it. */
  toolVersion: string;
  /** Model identifier, or null when no model was involved. */
  model: string | null;
  /** Prompt version, or null when no model was involved. */
  promptVersion: string | null;
}

export interface HypothesisBody extends Record<string, unknown> {
  product: string;
  component: string;
  cve: string;
  assertion: string;
  basis: string;
  /** Never optional. An unattributed machine finding is what this prevents. */
  provenance: HypothesisProvenance;
  /**
   * The reachability verdict, when an analyser ran. It lives on a HYPOTHESIS
   * and never on a claim: deciding reachability is the expensive act, signing
   * it is the accountable one, and they are done by different actors.
   */
  reachability?: ReachabilityVerdict;
  /** Never a claim. A human converts this, or it stays a hypothesis. */
  requiresHumanSignOff: true;
}

export interface ClockBody extends Record<string, unknown> {
  product: string;
  cve: string;
  article: string;
  /**
   * When the manufacturer became aware. THE CLOCK RUNS FROM HERE, not from when this
   * command ran. Article 14(2) says "after the manufacturer becomes aware", and those are
   * different moments whenever a scan happens after the fact.
   */
  becameAwareAt: string;
  /** When it was written down. Kept separate: the gap is itself a fact. */
  recordedAt: string;
  /** null for Article 14(2)(c) until a corrective measure is recorded. */
  dueAt: string | null;
  deliverable: string;
}

/**
 * Article 14(2)(a)-(c).
 *
 * (a) and (b) run from AWARENESS. (c) does not: the Regulation says "no later
 * than 14 days after a corrective or mitigating measure IS AVAILABLE". This
 * table used to give (c) `days: 14` and the due date was computed from
 * awareness like the others, which invents a deadline the Regulation does not
 * impose. A fix that took thirty days would have been reported overdue on day
 * fourteen, pushing a manufacturer to file prematurely or to believe they were
 * in breach. (c) therefore has no due date until a remedy is recorded.
 */
const ARTICLE_14_CLOCKS = [
  { article: '14(2)(a)', hours: 24, deliverable: 'Early warning notification to the CSIRT coordinator and ENISA' },
  { article: '14(2)(b)', hours: 72, deliverable: 'Vulnerability notification to the CSIRT coordinator and ENISA' },
  {
    article: '14(2)(c)',
    fromRemedy: 14,
    deliverable: 'Final report, no later than 14 days after a corrective or mitigating measure is available',
  },
] as const;

export async function craWatch(
  io: CraIo,
  opts: {
    kev?: string;
    product?: string;
    json?: boolean;
    /** ISO timestamp the manufacturer became aware. Required before a real clock starts. */
    becameAwareAt?: string;
    /** Explicit affirmation that awareness is now. The convenience path, chosen not assumed. */
    becameAwareNow?: boolean;
    ir?: string;
    entry?: string;
    symbols?: string;
    analyser?: string;
    epss?: string;
    epssFetch?: boolean;
    osv?: string;
  },
): Promise<number> {
  const evidence = asOf(readStream<EvidenceBody>(io.cwd, 'evidence'));
  if (evidence.length === 0) {
    io.error('No evidence ingested. Run: legalithm cra ingest --sbom <path>');
    return 1;
  }

  // Evidence rows carry the product KEY, so --product is resolved to one before
  // anything is filtered. Same resolver as `cra ingest`, so the flag means the
  // same thing in both, which it previously did not.
  let productKeyFilter: string | undefined;
  if (opts.product) {
    const resolved = resolveProduct(asOf(readStream<ProductBody>(io.cwd, 'products')), opts.product);
    if ('error' in resolved) {
      io.error(resolved.error);
      return 1;
    }
    productKeyFilter = productKey(resolved.product.body);
  }

  /*
   * Article 14 duties land on the manufacturer, so analysing a product you did
   * not make starts no clock. Found by running this pipeline over curl 8.11.1,
   * which produced three Article 14 clocks against a product we do not make.
   */
  const analysisOnly = asOf(readStream<ProductBody>(io.cwd, 'products')).some(
    (p) => p.body.analysisOnly,
  );

  let kev: KevCatalogue;
  try {
    if (opts.kev) {
      kev = JSON.parse(readFileSync(opts.kev, 'utf8')) as KevCatalogue;
    } else {
      kev = await (io.fetchKev ?? defaultFetchKev)();
    }
  } catch (e) {
    io.error(`Could not load the KEV catalogue: ${(e as Error).message}`);
    io.error('Pass a local copy with --kev <path> to run fully offline.');
    return 1;
  }

  // The join happens here and stays here. Nothing is uploaded.
  const byComponent = new Map<string, EvidenceBody[]>();
  for (const e of evidence) {
    const list = byComponent.get(e.body.component.toLowerCase()) ?? [];
    list.push(e.body);
    byComponent.set(e.body.component.toLowerCase(), list);
  }

  const now = (io.now ?? (() => new Date()))();

  /*
   * Resolve awareness BEFORE any scanning, so a malformed timestamp fails fast rather than
   * after the operator has waited for a KEV fetch.
   */
  let awareness: Date | null = null;
  if (opts.becameAwareAt !== undefined) {
    const parsed = new Date(opts.becameAwareAt);
    if (Number.isNaN(parsed.getTime())) {
      io.error(`Could not read --became-aware-at "${opts.becameAwareAt}". Use an ISO timestamp.`);
      return 1;
    }
    if (parsed.getTime() > now.getTime()) {
      // A future awareness time would silently buy hours on the clock, and you cannot have
      // become aware of something that has not happened.
      io.error('--became-aware-at is in the future. Awareness cannot postdate now.');
      return 1;
    }
    awareness = parsed;
  } else if (opts.becameAwareNow) {
    awareness = now;
  }

  const kevIds = new Set((kev.vulnerabilities ?? []).map((v) => v.cveID.toUpperCase()));
  /** cveID -> dateAdded, so a hypothesis that DOES cite KEV can cite it precisely. */
  const kevAdded = new Map(
    (kev.vulnerabilities ?? []).map((v) => [v.cveID.toUpperCase(), v.dateAdded] as const),
  );
  const hits: { component: string; cve: string; product: string; dateAdded?: string }[] = [];
  /** Findings that carry an Article 14 duty, i.e. actively exploited ones. */
  let clocksStarted = 0;

  /*
   * KEV IS A SET OF CVE IDS. IT IS NOT AN INDEX OF YOUR COMPONENTS.
   *
   * This used to walk the catalogue and keep an entry when the component name
   * appeared as a substring of `vulnerabilityName`, KEV's free-text human
   * description. That cannot work, and it failed in the dangerous direction.
   * The real entry for the libwebp bug reads:
   *
   *     product            Chromium WebP
   *     vulnerabilityName  Google Chromium WebP Heap-Based Buffer Overflow Vulnerability
   *
   * "libwebp" appears in neither field. So an SBOM containing libwebp 1.3.1
   * was told no component matched an actively exploited vulnerability, for a
   * CVE that is in KEV and being exploited, and the Article 14 clock never
   * started. KEV names the SHIPPING PRODUCT; an SBOM names the LIBRARY, and no
   * amount of string matching bridges that.
   *
   * It failed the other way too: a component called `chrome`, `go` or `net`
   * would match large numbers of unrelated entries.
   *
   * So the direction is inverted. A source that maps components to CVEs finds
   * the candidates, and KEV then answers the only question it can answer:
   * is that CVE being exploited. That is what `prioritise` does below.
   */
  if (!opts.osv) {
    io.error('No component-to-CVE source, so there is nothing to check KEV against.');
    io.error('');
    io.error('KEV is a list of CVE ids that are being actively exploited. It does not');
    io.error('say which of YOUR components are affected: it names shipping products');
    io.error('("Chromium WebP"), while an SBOM names libraries ("libwebp").');
    io.error('');
    io.error('Supply advisory data that maps components to CVEs:');
    io.error('  legalithm cra watch --osv <osv-dump> [--kev <kev.json>] [--epss <csv>]');
    io.error('');
    io.error('Refusing rather than reporting zero findings, because zero findings');
    io.error('here would read as "you are clear" when nothing was actually checked.');
    return 1;
  }

  // OSV widens the net beyond KEV: KEV is only what is being exploited today.
  // Matched LOCALLY against a downloaded dump, never by querying per package,
  // because a per-package query would send the SBOM to a third party.
  if (opts.osv) {
    try {
      const osvMatches = matchOsv(
        evidence
          // The empty-SBOM marker is a statement about the product, not a
          // package, and must never be looked up as one.
          .filter((e) => e.body.component !== NO_COMPONENTS)
          .map((e) => ({
            component: e.body.component,
            // The field when present; the old prose parse only for rows that
            // predate it.
            version: e.body.version ?? String(e.body.assertion).split(' ').pop() ?? 'unknown',
          })),
        loadOsv(opts.osv),
      );
      for (const m of osvMatches) {
        if (!m.cve) continue;
        if (hits.some((h) => h.cve === m.cve && h.component === m.component)) continue;
        const owner = evidence.find((e) => e.body.component === m.component);
        if (!owner) continue;
        if (productKeyFilter && owner.body.product !== productKeyFilter) continue;
        hits.push({ component: m.component, cve: m.cve, product: owner.body.product });
      }
    } catch (e) {
      io.error(`Could not read the OSV dump: ${(e as Error).message}`);
      return 1;
    }
  }

  // EPSS ranks what is left. It NEVER discharges anything: a low score means
  // deprioritise, not "not affected". Only a signed reachability verdict does
  // that. Loaded whole, joined locally, for the same reason as OSV.
  let epss = new Map<string, EpssScore>();
  if (opts.epss || opts.epssFetch) {
    try {
      epss = opts.epss ? loadEpss(opts.epss) : await fetchEpss();
    } catch (e) {
      io.error(`Could not load EPSS: ${(e as Error).message}`);
      return 1;
    }
  }

  // Reachability is optional. Without it a KEV match is a presence finding and
  // is reported as exactly that, never as "affected".
  const reachabilityOn = Boolean(opts.ir && opts.entry);
  const verdicts = new Map<string, ReachabilityVerdict>();
  if (reachabilityOn) {
    let symbols: Record<string, string[]> = {};
    if (opts.symbols) {
      try {
        symbols = loadSymbolMap(opts.symbols);
      } catch (e) {
        io.error(`Could not read the symbol map: ${(e as Error).message}`);
        return 1;
      }
    }
    // Only the LLVM analyser is built today. It is constructed HERE rather than
    // reached for inside the assessment, so a second substrate is a different
    // constructor on this line and no change at all below it.
    const analyser = llvmAnalyser({
      irDirs: opts.ir!.split(',').map((d) => d.trim()).filter(Boolean),
      analyserPath: opts.analyser ?? defaultAnalyserPath(io.cwd),
    });
    for (const cve of new Set(hits.map((h) => h.cve))) {
      verdicts.set(
        cve,
        io.assessCve ? io.assessCve(cve) : assessCve({ entry: opts.entry!, symbols, analyser }, cve),
      );
    }
  }

  for (const hit of hits) {
    const verdict = verdicts.get(hit.cve);

    /*
     * SAY WHICH SOURCE ACTUALLY SAID IT.
     *
     * `hits` comes from OSV, which is deliberately wider than KEV: it lists
     * vulnerabilities known to affect a component, exploited or not. KEV is the
     * much smaller set being exploited TODAY. This loop used to stamp every hit
     * with "appears in the CISA KEV catalogue as actively exploited" and a basis
     * of "CISA KEV <cve>", regardless of whether the CVE was in KEV at all.
     *
     * On the first real run that produced 46 hypotheses asserting active
     * exploitation, of which 0 were in the catalogue. Active exploitation is the
     * Article 14(1) trigger, so the record read as 46 notification duties that
     * did not exist, each one attributed to a public catalogue that did not say
     * it. The clocks were gated on `kevIds` and stayed correct; only the prose a
     * human signs was wrong, which is the half nobody re-derives.
     *
     * An unexploited CVE is not nothing. It is an Annex I Part II
     * vulnerability-handling matter, and it is recorded as exactly that.
     */
    const exploited = kevIds.has(hit.cve.toUpperCase());
    const addedOn = kevAdded.get(hit.cve.toUpperCase());

    /*
     * A finding inherits the doubt of the component it is about.
     *
     * If the component was identified by binary analysis rather than read from
     * a build manifest, the finding rests on the tool being right that the
     * component is there at all. Stating the CVE without that is how a
     * fingerprint guess becomes "your product is affected".
     */
    const owner = evidence.find((e) => e.body.component === hit.component);
    const identifiedByAnalysis = owner?.body.sourceType === 'analysis';
    const identityNote = identifiedByAnalysis
      ? ` The component was identified by analysis (${String(owner?.body.confidence)}), not read from a build manifest, so this finding also depends on it being present.`
      : '';

    append<HypothesisBody>(
      io.cwd,
      'hypotheses',
      {
        product: hit.product,
        component: hit.component,
        cve: hit.cve,
        assertion: exploited
          ? `${hit.component} is affected by ${hit.cve}, which the CISA KEV catalogue lists as actively exploited`
          : `${hit.component} is affected by ${hit.cve} per OSV. It is NOT in the CISA KEV catalogue, so no active exploitation is asserted`,
        // Deterministic join: nulls say so explicitly rather than by omission.
        provenance: { tool: TOOL_ID, toolVersion: VERSION, model: null, promptVersion: null },
        basis: exploited
          ? `CISA KEV ${hit.cve}${addedOn ? ` added ${addedOn}` : ''}${identityNote}`
          : `OSV advisory for ${hit.cve}; absent from CISA KEV${identityNote}`,
        ...(verdict ? { reachability: verdict } : {}),
        requiresHumanSignOff: true,
      },
      { now: io.now },
    );

    /*
     * ACTIVE EXPLOITATION IS THE TRIGGER. Article 14(1), verbatim:
     *
     *   "A manufacturer shall notify any ACTIVELY EXPLOITED vulnerability
     *    contained in the product with digital elements that it becomes aware
     *    of ... to the CSIRT designated as coordinator ... and to ENISA."
     *
     * "contained in the product" says WHICH exploited vulnerabilities count. It
     * is not itself the trigger, and a known but unexploited CVE carries no
     * Article 14 duty at all: it is an Annex I Part II vulnerability-handling
     * matter.
     *
     * This loop used to run for every hit, which was correct while KEV was the
     * only source and every hit was by definition actively exploited. Adding
     * the OSV join widened `hits` to known-but-unexploited CVEs and silently
     * broke that invariant. On a real 304-component SBOM it started 138 clocks
     * across 46 vulnerabilities, none of them in KEV, which would have told a
     * manufacturer to file 46 early warnings with a CSIRT coordinator inside 24
     * hours for vulnerabilities carrying no reporting duty.
     *
     * Reachability still does NOT gate this: a reachability verdict speaks to
     * Annex I conformity, not to the reporting trigger.
     */
    if (!kevIds.has(hit.cve.toUpperCase())) continue;
    if (analysisOnly) continue;

    /*
     * AWARENESS IS REQUIRED BEFORE A STATUTORY CLOCK STARTS.
     *
     * This used to compute dueAt from `now`, the moment the command ran. A team aware on
     * Tuesday 10:15 that scanned on Thursday 14:00 was told the early warning was due
     * Friday 14:00; it was due Wednesday 10:15, already two days gone. Wrong in the
     * direction that tells a manufacturer they have more time.
     *
     * There is deliberately NO silent default to now. That reproduces the same wrong
     * deadline behind a more explicit API, because the flag is simply forgotten. Awareness
     * is a fact only the operator holds, and inventing it here would be the same mistake
     * as guessing an ambiguous corpus pin instead of reporting UNKNOWN.
     */
    if (!awareness) {
      io.error(
        'Refusing to start an Article 14 clock without an awareness timestamp.\n' +
          'The clock runs from when you became aware, not from when this ran.\n' +
          '  --became-aware-at <ISO timestamp>   when you actually knew\n' +
          '  --became-aware-now                  affirm that you became aware just now',
      );
      return 1;
    }

    clocksStarted += 1;
    for (const clock of ARTICLE_14_CLOCKS) {
      let dueAt: string | null = null;
      if ('hours' in clock) {
        const due = new Date(awareness);
        due.setUTCHours(due.getUTCHours() + clock.hours);
        dueAt = due.toISOString();
      }
      // 'fromRemedy' clocks stay null until a corrective measure is recorded.
      append<ClockBody>(
        io.cwd,
        'clocks',
        {
          product: hit.product,
          cve: hit.cve,
          article: clock.article,
          becameAwareAt: awareness.toISOString(),
          recordedAt: now.toISOString(),
          dueAt,
          deliverable: clock.deliverable,
        },
        { now: io.now },
      );
    }
  }

  if (opts.json) {
    io.log(
      JSON.stringify(
        {
          checked: byComponent.size,
          reachability: reachabilityOn ? 'run' : 'not run',
          hits: hits.map((h) => ({ ...h, verdict: verdicts.get(h.cve)?.status ?? null })),
        },
        null,
        2,
      ),
    );
    return hits.length > 0 ? 2 : 0;
  }

  // The empty-SBOM marker occupies a slot in `byComponent` but is not a
  // component, and counting it would report "Checked 1 component(s)" for a
  // product whose SBOM says it has none.
  const realComponents = [...byComponent.keys()].filter(
    (k) => k !== NO_COMPONENTS.toLowerCase(),
  ).length;

  if (realComponents === 0) {
    io.log('The SBOM records no third-party components, so there was nothing to match.');
    io.log('');
    io.log('This is a result, not a gap: an SBOM was ingested and it lists nothing.');
    io.log('It says nothing about the product\'s own code, which no advisory feed');
    io.log('covers. Annex I Part II (1) is satisfied by the SBOM; Part II (3), the');
    io.log('duty to test and review the product itself, is untouched by this run.');
    return 0;
  }

  io.log(
    `Checked ${realComponents} component(s) against the advisory data, ` +
      `with ${kevIds.size} KEV entries for exploitation status.`,
  );
  if (hits.length === 0) {
    io.log('No component matched a known vulnerability in the advisory data supplied.');
    io.log('');
    io.log('That is NOT "not affected". It is the limit of what was searched: an');
    io.log('advisory dump only knows what has been published and matched to a version.');
    io.log('Reachability, and unpublished vulnerabilities, are separate questions.');
    return 0;
  }

  const ranked = prioritise(hits, kevIds, epss);

  io.log('');
  io.log(`${hits.length} component finding(s), highest priority first:`);
  for (const h of ranked) {
    const v = verdicts.get(h.cve);
    const tags = [h.inKev ? 'KEV' : null, h.epss !== undefined ? `EPSS ${(h.epss * 100).toFixed(1)}%` : null]
      .filter(Boolean)
      .join(' ');
    io.log(`  ${h.cve}  ${h.component}${tags ? `  ${tags}` : ''}${v ? `  [${v.status}]` : ''}`);
    if (v) io.log(`      ${v.rationale}`);
    if (v?.callPath?.length) io.log(`      path: ${v.callPath.slice(0, 6).join(' -> ')}${v.callPath.length > 6 ? ' -> ...' : ''}`);
  }

  if (!reachabilityOn) {
    io.log('');
    io.log('Reachability was NOT run, so these are presence findings, not exploitability');
    io.log('findings. Add --ir <dirs> --entry <fn> --symbols <map> to decide them.');
  }

  io.log('');
  if (analysisOnly) {
    io.log('No Article 14 clock started: this product is registered as THIRD-PARTY ANALYSIS.');
    io.log('Reporting duties under Article 14 land on the manufacturer, and analysing a');
    io.log('product you did not make does not give you one. The findings above stand; the');
    io.log('reporting duty belongs to whoever placed this product on the market.');
  } else if (clocksStarted === 0) {
    io.log(`No Article 14 clock started: none of the ${hits.length} finding(s) is actively exploited.`);
    io.log('Article 14(1) is triggered by an ACTIVELY EXPLOITED vulnerability. A known but');
    io.log('unexploited CVE carries no reporting duty; it is an Annex I Part II');
    io.log('vulnerability-handling matter. That is not a discharge, it is a different duty.');
  } else {
    io.log(`Article 14 clocks started for ${clocksStarted} actively exploited finding(s). HYPOTHESES, not claims:`);
    for (const clock of ARTICLE_14_CLOCKS) {
        const when = 'hours' in clock ? `${clock.hours}h` : `${clock.fromRemedy}d after remedy`;
      io.log(`  ${clock.article}  ${when}  ${clock.deliverable}`);
    }
    io.log('');
    io.log('The clock is not gated on reachability: reachability speaks to Annex I');
    io.log('conformity, not to the Article 14 reporting trigger.');
  }
  io.log('Reporting duties apply from ' + CRA_REPORTING_APPLIES_FROM + ' (Article 71(2)).');
  io.log('Nothing has been filed. Submit through the ENISA Single Reporting Platform.');
  return 2;
}

// ---------------------------------------------------------------- support ---

export interface SupportBody extends Record<string, unknown> {
  until: string;
  placedOn?: string;
  declaredBy: string;
  rationale: string;
  expectedUseShorter?: boolean;
}

/**
 * Record or report the support period.
 *
 * A date with no reasoning is an incomplete record: Article 13(8) requires the
 * information used to determine the period to be in the technical
 * documentation, which is Annex VII (4). So --rationale is not optional.
 */
export function craSupport(
  io: CraIo,
  opts: {
    until?: string;
    placedOn?: string;
    by?: string;
    rationale?: string;
    expectedUseShorter?: boolean;
    json?: boolean;
  },
): number {
  const now = (io.now ?? (() => new Date()))();

  if (opts.until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.until)) {
      io.error(`--until must be an ISO date, got "${opts.until}"`);
      return 1;
    }
    if (!opts.by || !opts.rationale) {
      io.error('Usage: legalithm cra support --until <YYYY-MM-DD> --by "<name>" --rationale "<what you took into account>"');
      io.error('Article 13(8) requires the information used to determine the period; Annex VII (4) requires it in the file.');
      return 1;
    }
    const body: SupportBody = {
      until: opts.until,
      ...(opts.placedOn ? { placedOn: opts.placedOn } : {}),
      declaredBy: opts.by,
      rationale: opts.rationale,
      ...(opts.expectedUseShorter ? { expectedUseShorter: true } : {}),
    };
    const prior = asOf(readStream<SupportBody>(io.cwd, 'support'));
    const last = prior[prior.length - 1];
    const { event } = append<SupportBody>(io.cwd, 'support', body, {
      now: io.now,
      ...(last && last.body.until !== opts.until ? { supersedes: last.id } : {}),
    });
    io.log(`Support period recorded: ends ${opts.until}`);
    io.log(`  declared by  ${opts.by}`);
    io.log(`  event        ${event.id.slice(0, 16)}`);
    const s = supportStatus({ ...body } as SupportPeriod, now);
    if (s.verdict !== 'ok') {
      io.log('');
      io.log(`  ${s.basis}: ${s.message}`);
    }
    return supportExitCode(s);
  }

  const rows = asOf(readStream<SupportBody>(io.cwd, 'support'));
  const latest = rows[rows.length - 1];
  const status = supportStatus(latest ? ({ ...latest.body } as SupportPeriod) : null, now);

  if (opts.json) {
    io.log(JSON.stringify({ ...status, ...(latest ? { declaredBy: latest.body.declaredBy, rationale: latest.body.rationale } : {}) }, null, 2));
    return supportExitCode(status);
  }

  io.log(`Support period: ${status.verdict.toUpperCase().replace(/_/g, ' ')}`);
  io.log(`  ${status.message}`);
  io.log(`  basis  ${status.basis}`);
  if (latest) {
    io.log(`  by     ${latest.body.declaredBy}`);
    io.log(`  why    ${latest.body.rationale}`);
  }
  return supportExitCode(status);
}

// -------------------------------------------------------------------- doc ---

/**
 * Assemble Annex VII or Annex V from the evidence store.
 *
 * Gaps are emitted as gaps. The alternative — generating plausible prose for an
 * item the record cannot support — is manufacturing evidence, and for the
 * declaration it would be putting words into the mouth of the person who signs
 * under their sole responsibility.
 */
/** Annex VII and Annex V are the MANUFACTURER's documents to draw up. */
function refuseIfThirdParty(io: CraIo, what: string): boolean {
  const p = asOf(readStream<ProductBody>(io.cwd, 'products')).find((x) => x.body.analysisOnly);
  if (!p) return false;
  io.error(`Refusing to generate ${what} for a product registered as third-party analysis.`);
  io.error(`${p.body.name} ${p.body.version} is made by ${p.body.manufacturer}, not by you.`);
  io.error('Article 31 puts the technical documentation on the manufacturer, and Annex V (3)');
  io.error('makes the declaration their sole responsibility. Drafting either here would be');
  io.error("producing a document in someone else's name.");
  return true;
}

export function craDoc(
  io: CraIo,
  opts: { type?: string; out?: string; json?: boolean; format?: 'md' | 'html' | 'pdf' },
): number {
  const TYPES: Record<string, 'technical-documentation' | 'declaration-of-conformity'> = {
    'technical-file': 'technical-documentation',
    'technical-documentation': 'technical-documentation',
    declaration: 'declaration-of-conformity',
    doc: 'declaration-of-conformity',
  };
  if (refuseIfThirdParty(io, 'a conformity document')) return 1;
  const kind = opts.type ? TYPES[opts.type] : undefined;
  if (!kind) {
    io.error('Usage: legalithm cra doc --type <technical-file|declaration> [--out <path>]');
    return 1;
  }

  const products = asOf(readStream<ProductBody>(io.cwd, 'products'));
  const product = products[products.length - 1]?.body;
  const evidence = asOf(readStream<EvidenceBody>(io.cwd, 'evidence'));
  const assessments = asOf(readStream<AssessmentBody>(io.cwd, 'assessments'));
  const hypotheses = asOf(readStream<HypothesisBody>(io.cwd, 'hypotheses'));
  const claims = asOf(readStream<ClaimBody>(io.cwd, 'claims'));
  const signedCves = new Set(claims.map((c) => String(c.body.cve).toUpperCase()));

  const annexIStatus: Record<string, string> = {};
  for (const a of assessments) annexIStatus[a.body.ref] = a.body.status;

  /*
   * The support period can be recorded two ways, and the document has to see
   * both. `cra product --support-until` puts it on the product row; `cra
   * support` writes it to its own stream with the rationale Article 13(8)
   * requires. Reading only the product row meant Annex VII (4) stayed a GAP
   * after a manufacturer had recorded exactly the information that item asks
   * for, which is the worst kind of gap: one the tool created itself.
   */
  const recordedRisk = asOf(readStream<RiskBody>(io.cwd, 'risk'));
  const latestRisk = recordedRisk[recordedRisk.length - 1]?.body;

  /*
   * A hash nothing checks is decoration.
   *
   * The record pins the assessment's content so it cannot be rewritten after the
   * fact. That is only worth anything if somebody compares them, and the moment
   * to do it is when the technical file cites the document. A stale citation is
   * worse than a missing one: it looks like the assessment says something it no
   * longer says.
   */
  let riskDrifted = false;
  if (latestRisk) {
    const p = join(io.cwd, latestRisk.document);
    riskDrifted = !existsSync(p)
      || createHash('sha256').update(readFileSync(p)).digest('hex') !== latestRisk.documentHash;
  }

  const recordedSupport = asOf(readStream<SupportBody>(io.cwd, 'support'));
  const latestSupport = recordedSupport[recordedSupport.length - 1]?.body.until;

  const facts: DocumentFacts = {
    ...(latestRisk && !riskDrifted
      ? {
          riskAssessment: {
            document: latestRisk.document,
            documentHash: latestRisk.documentHash,
            declaredBy: latestRisk.declaredBy,
            summary: latestRisk.summary,
          },
        }
      : {}),
    ...(product
      ? {
          product: {
            name: product.name,
            version: product.version,
            productClass: product.productClass,
            ...(product.supportUntil ?? latestSupport
              ? { supportUntil: product.supportUntil ?? String(latestSupport) }
              : {}),
          },
        }
      : {}),
    evidenceCount: evidence.length,
    annexIStatus,
    annexIAssessed: Object.keys(annexIStatus).length,
    annexITotal: annexIRequirements().length,
    openFindings: hypotheses.filter((h) => !signedCves.has(h.body.cve.toUpperCase())).length,
    asOf: (io.now ?? (() => new Date()))().toISOString(),
  };

  const doc = generateDocument(kind, facts);

  if (opts.json) {
    io.log(JSON.stringify(doc, null, 2));
    return doc.complete ? 0 : 3;
  }

  const md = renderDocumentMarkdown(doc);
  const outPath = opts.out ?? join(io.cwd, CRA_DIR, `${kind}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md, 'utf8');

  /*
   * Markdown is right for the engineer who runs this and wrong for everybody it
   * is handed to. The HTML is self-contained and carries print CSS, so a browser
   * turns it into a PDF without this package growing a dependency: `legalithm`
   * installs one package and no third-party code, and that is a determination in
   * the record rather than a slogan.
   */
  let htmlPath: string | null = null;
  let pdfPath: string | null = null;
  let pdfNote: string | null = null;
  if (opts.format === 'html' || opts.format === 'pdf') {
    htmlPath = outPath.replace(/\.md$/, '.html');
    writeFileSync(htmlPath, renderDocumentHtml(doc, { generatedAt: String(io.now ? io.now() : new Date().toISOString()) }), 'utf8');
  }
  if (opts.format === 'pdf' && htmlPath) {
    const target = htmlPath.replace(/\.html$/, '.pdf');
    const result = io.htmlToPdf ? io.htmlToPdf(htmlPath, target) : htmlToPdf(htmlPath, target);
    if (result.ok) {
      pdfPath = target;
      pdfNote = result.degraded
        ? `converted with ${result.converter}, which ignores most print styling — a browser gives a better result`
        : `converted with ${result.converter}`;
    } else {
      pdfNote = result.reason ?? 'conversion failed';
    }
  }

  io.log(`${kind === 'technical-documentation' ? 'Technical documentation' : 'EU declaration of conformity'} draft`);
  io.log(`  basis    ${doc.basis}`);
  io.log(`  items    ${doc.sections.length}`);
  io.log(`  filled   ${doc.sections.length - doc.gaps.length}`);
  io.log(`  GAPS     ${doc.gaps.length}`);
  io.log(`  written  ${outPath}`);
  if (htmlPath) io.log(`  print    ${htmlPath}`);
  if (pdfPath) io.log(`  pdf      ${pdfPath}${pdfNote ? `  (${pdfNote})` : ''}`);
  else if (pdfNote) {
    io.log('');
    io.log(`  No PDF written. ${pdfNote}`);
  }
  if (riskDrifted && latestRisk) {
    io.log('');
    io.log(`  ⚠ ${latestRisk.document} no longer matches the hash recorded for it.`);
    io.log('    The technical file cites the assessment by CONTENT, so a changed');
    io.log('    document is not the one that was assessed. Annex VII (3) drops the');
    io.log('    citation and reports the assessment as NOT held, rather than pointing');
    io.log('    an auditor at something that has since been rewritten.');
    io.log('    Re-record it: legalithm cra risk --document <path> --by "<name>" --summary "<line>"');
  }
  if (doc.gaps.length) {
    io.log('');
    io.log('Gaps, each with its verbatim requirement in the file:');
    for (const g of doc.gaps) io.log(`  ${g}`);
    io.log('');
    io.log('These are left empty on purpose. Filling them with generated prose would be');
    io.log('manufacturing evidence, and for the declaration it would be writing words the');
    io.log('manufacturer signs under their sole responsibility.');
  }
  return doc.complete ? 0 : 3;
}

// ----------------------------------------------------------------- assess ---

export interface AssessmentBody extends Record<string, unknown> {
  ref: string;
  status: Exclude<RequirementStatus, 'not_assessed'>;
  declaredBy: string;
  rationale?: string;
  /**
   * The product version this determination was made ABOUT.
   *
   * Its absence was a correctness hole, not a missing field. Annex I compliance
   * is a statement about a product, and a determination is a person putting
   * their name to one. Without this, 22 determinations declared about 0.6.1
   * appeared unchanged in the 0.6.2 record, still dated 15 August, with a
   * human's name against them. Nobody had said anything about 0.6.2.
   *
   * It happened not to matter, because 0.6.2 also has zero dependencies. A
   * version that added some would have kept asserting Annex I (2)(j) as met
   * while being false, which is the failure this product exists to prevent.
   *
   * Optional because rows written before this existed do not carry it, and
   * dropping them would silently delete work somebody did. They are surfaced as
   * unscoped instead: neither treated as current, nor thrown away.
   */
  productVersion?: string;
}

/**
 * Assess the product against Annex I, or record a determination about one
 * requirement.
 *
 * `met` is only ever reached because a named person said so. There is no
 * automatic pass, and an unanswered requirement reports `not_assessed` rather
 * than defaulting to fine. A gap report whose default is "fine" is worse than
 * no report.
 */
export function craAssess(
  io: CraIo,
  opts: {
    ref?: string;
    status?: string;
    by?: string;
    rationale?: string;
    part?: string;
    gaps?: boolean;
    json?: boolean;
  },
): number {
  const STATUSES = ['met', 'not_met', 'not_applicable'];

  // Recording a determination.
  if (opts.ref || opts.status) {
    if (!opts.ref || !opts.status || !opts.by) {
      io.error('Usage: legalithm cra assess --ref "<Annex I ref>" --status <met|not_met|not_applicable> --by "<name>"');
      io.error('  A requirement is only met because a named person says so.');
      return 1;
    }
    if (!STATUSES.includes(opts.status)) {
      io.error(`Unknown --status "${opts.status}". One of: ${STATUSES.join(', ')}.`);
      io.error('not_assessed is not assertable: it is what a requirement reports when nobody has determined it.');
      return 1;
    }
    if (!isAnnexIRef(opts.ref)) {
      io.error(`"${opts.ref}" is not an Annex I requirement. Run: legalithm cra assess --gaps`);
      return 1;
    }
    if (opts.status === 'met' && !opts.rationale) {
      io.error('met needs --rationale. It is the determination that carries the product to market under Article 6.');
      return 1;
    }
    // A determination is about a product version, so one has to be registered.
    const declaredProducts = asOf(readStream<ProductBody>(io.cwd, 'products'));
    if (declaredProducts.length === 0) {
      io.error('No product registered, so there is nothing to determine this about.');
      io.error('Run: legalithm cra product --name <name> --version <version>');
      return 1;
    }
    const current = declaredProducts[declaredProducts.length - 1]!.body;

    const { event, created } = append<AssessmentBody>(
      io.cwd,
      'assessments',
      {
        ref: opts.ref,
        status: opts.status as AssessmentBody['status'],
        declaredBy: opts.by,
        ...(opts.rationale ? { rationale: opts.rationale } : {}),
        productVersion: current.version,
      },
      { now: io.now },
    );
    io.log(created ? `Recorded: ${opts.ref} is ${opts.status}` : `Identical determination already recorded`);
    io.log(`  about        ${current.name} ${current.version}`);
    io.log(`  declared by  ${opts.by}`);
    io.log(`  assessment   ${event.id.slice(0, 16)}`);
    return 0;
  }

  // Reporting.
  const rows = asOf(readStream<AssessmentBody>(io.cwd, 'assessments'));
  const claims: AnnexIClaim[] = rows.map((r) => ({
    ref: r.body.ref,
    status: r.body.status,
    declaredBy: r.body.declaredBy,
    declaredAt: r.observedAt,
    ...(r.body.rationale ? { rationale: r.body.rationale } : {}),
  }));
  const evidence = asOf(readStream<EvidenceBody>(io.cwd, 'evidence')).map((e) => ({
    ref: String(e.body.component),
  }));
  const report = buildAnnexIReport(claims, evidence);

  if (opts.json) {
    io.log(JSON.stringify(report, null, 2));
    return report.counts.not_assessed > 0 ? 3 : report.counts.not_met > 0 ? 2 : 0;
  }

  if (opts.gaps) {
    io.log(`${report.gaps.length} of ${report.total} Annex I requirements have no determination:`);
    const byRef = new Map(annexIRequirements().map((r) => [r.ref, r]));
    for (const ref of report.gaps) io.log(`  ${ref.padEnd(24)} ${byRef.get(ref)?.description.slice(0, 76) ?? ''}`);
    io.log('');
    io.log('Record one with:');
    io.log('  legalithm cra assess --ref "<ref>" --status met --by "<name>" --rationale "..."');
    return report.gaps.length ? 3 : 0;
  }

  io.log(`Annex I assessment (corpus ${report.corpusVersion})`);
  io.log(`  met            ${report.counts.met}`);
  io.log(`  not met        ${report.counts.not_met}`);
  io.log(`  not applicable ${report.counts.not_applicable}`);
  io.log(`  NOT ASSESSED   ${report.counts.not_assessed}   <- the work list`);
  io.log(`  total          ${report.total}`);
  io.log('');
  const parts: ('I' | 'II')[] = ['I', 'II'];
  for (const part of parts) {
    const inPart = report.requirements.filter((r) => r.part === part);
    const done = inPart.filter((r) => r.status !== 'not_assessed').length;
    io.log(`  Part ${part.padEnd(3)} ${done}/${inPart.length} determined  (${part === 'I' ? 'product properties' : 'vulnerability handling'})`);
  }
  io.log('');
  if (annexIComplete(report)) {
    io.log('Every Annex I requirement is determined and none is unmet.');
    io.log('That is the Article 6 condition. It is not conformity: Article 32 still applies.');
  } else {
    io.log('Article 6 makes Annex I the condition of being made available on the market.');
    io.log('Run  legalithm cra assess --gaps  for the work list.');
  }
  return report.counts.not_assessed > 0 ? 3 : report.counts.not_met > 0 ? 2 : 0;
}

// --------------------------------------------------------------- classify ---

export interface ClassificationBody extends Record<string, unknown> {
  input: ClassifyInput;
  determination: Determination;
}

/**
 * Applicability and classification, re-runnable.
 *
 * The determination is stored, not just printed, so a re-run after the
 * Commission changes its guidance produces a NEW event that supersedes the old
 * one and both stay readable. "We concluded out of scope in August 2026 on
 * these facts" is the answer a market surveillance authority actually asks for,
 * and a tool that only prints cannot give it.
 */
export function craClassify(
  io: CraIo,
  opts: {
    kind?: string;
    connected?: boolean;
    commercial?: boolean;
    euMarket?: boolean;
    excluded?: string;
    rdpsDistance?: boolean;
    rdpsManufacturer?: boolean;
    rdpsFunction?: boolean;
    annexIii?: string;
    annexIv?: boolean;
    role?: string;
    rebrands?: boolean;
    json?: boolean;
  },
): number {
  const KINDS = ['software', 'hardware', 'component', 'service_only'];
  if (!opts.kind || !KINDS.includes(opts.kind)) {
    io.error(`Usage: legalithm cra classify --kind <${KINDS.join('|')}> [flags]`);
    io.error('  --connected / --no-connected      Article 2(1) data connection test');
    io.error('  --commercial / --no-commercial    Article 3(22) commercial activity');
    io.error('  --excluded <medical|ivd|vehicle|aviation|marine|spare_part|defence>');
    io.error('  --rdps-distance --rdps-manufacturer --rdps-function   Article 3(2), for service_only');
    io.error('  --annex-iii <class_i|class_ii> | --annex-iv');
    io.error('  --role <manufacturer|importer|distributor|...> [--rebrands]');
    return 1;
  }

  const input: ClassifyInput = {
    kind: opts.kind as ClassifyInput['kind'],
    ...(opts.connected !== undefined ? { hasDataConnection: opts.connected } : {}),
    ...(opts.commercial !== undefined ? { commercialActivity: opts.commercial } : {}),
    ...(opts.euMarket !== undefined ? { placedOnEuMarket: opts.euMarket } : {}),
    ...(opts.excluded ? { excludedRegime: opts.excluded as ClassifyInput['excludedRegime'] } : {}),
    ...(opts.rdpsDistance !== undefined || opts.rdpsManufacturer !== undefined || opts.rdpsFunction !== undefined
      ? {
          rdps: {
            processesAtDistance: opts.rdpsDistance ?? false,
            byOrUnderManufacturer: opts.rdpsManufacturer ?? false,
            absenceBreaksAFunction: opts.rdpsFunction ?? false,
          },
        }
      : {}),
    ...(opts.annexIii ? { annexIii: opts.annexIii as 'class_i' | 'class_ii' } : {}),
    ...(opts.annexIv ? { annexIv: true } : {}),
    ...(opts.role ? { role: opts.role as Role } : {}),
    ...(opts.rebrands ? { rebrandsOrModifies: true } : {}),
  };

  const determination = classify(input);

  // Supersede the previous determination rather than overwrite it.
  const prior = asOf(readStream<ClassificationBody>(io.cwd, 'classification'));
  const last = prior[prior.length - 1];
  const changed = !last || last.body.determination.verdict !== determination.verdict;
  const { event } = append<ClassificationBody>(
    io.cwd,
    'classification',
    { input, determination },
    { now: io.now, ...(last && changed ? { supersedes: last.id } : {}) },
  );

  if (opts.json) {
    io.log(JSON.stringify({ event: event.id, ...determination }, null, 2));
    return determination.verdict === 'in_scope' ? 0 : determination.verdict === 'uncertain' ? 3 : 0;
  }

  io.log(`CRA applicability: ${determination.verdict.toUpperCase().replace(/_/g, ' ')}`);
  io.log(`  ${determination.reason}`);
  io.log('');
  io.log('How that was reached, every step cited:');
  for (const s of determination.steps) {
    io.log(`  ${s.basis.padEnd(16)} ${s.question}`);
    io.log(`  ${' '.repeat(16)} -> ${s.answer}`);
  }
  if (determination.verdict === 'in_scope') {
    io.log('');
    io.log(`  role       ${determination.role}${determination.effectiveRole !== determination.role ? ` (treated as ${determination.effectiveRole})` : ''}`);
    io.log(`  class      ${determination.productClass}`);
    io.log(`  route      ${determination.conformityRoute}`);
    io.log(`  from       Article 14 ${determination.appliesFrom!.reporting}, rest ${determination.appliesFrom!.general}`);
  }
  if (determination.verdict === 'in_scope' && determination.effectiveRole) {
    /*
     * The role was computed and then ignored. An importer used to be handed a
     * manufacturer's checklist, which is the one answer worse than none: it is
     * long, it is wrong, and every item on it is somebody else's duty.
     */
    const duties = dutiesFor(io.cwd, determination.effectiveRole as CraRole, {
      rebrandsOrModifies: Boolean(opts.rebrands),
    });
    if (duties.obligations.length > 0) {
      io.log('');
      io.log(`Your duties as ${duties.applied.join(' and ')} — ${duties.obligations.length} in the corpus:`);
      /*
       * Grouped by article, because the projection carries the ARTICLE title and
       * every paragraph of Article 19 therefore reads "Obligations of importers".
       * Five identical lines told a reader nothing; the paragraph numbers are the
       * information, and they are what a person looks up.
       */
      const byArticle = new Map<string, { title: string; paras: string[] }>();
      for (const o of duties.obligations) {
        const m = /^(Article \d+|Annex [IVX]+[^(]*)\s*(?:\(([^)]+)\))?/.exec(o.ref);
        const article = m?.[1] ?? o.ref;
        const para = m?.[2];
        if (!byArticle.has(article)) {
          byArticle.set(article, { title: o.title.replace(/^[^:]+:\s*/, ''), paras: [] });
        }
        if (para) byArticle.get(article)!.paras.push(`(${para})`);
      }
      for (const [article, { title, paras }] of byArticle) {
        io.log(`  ${article.padEnd(12)} ${title}`);
        if (paras.length) io.log(`  ${' '.repeat(12)} ${paras.join(' ')}`);
      }
      if (duties.reassigned) {
        io.log('');
        io.log('  Article 21 applies: placing under your own name or substantially modifying');
        io.log('  makes you a MANUFACTURER for this Regulation, so Articles 13 and 14 attach');
        io.log('  in full on top of your own role.');
      }
    }
  }

  io.log('');
  io.log(`Recorded as ${event.id.slice(0, 16)}. Re-run after a guidance change; a different`);
  io.log('verdict supersedes rather than overwrites, so the earlier answer stays readable.');
  io.log('This is a determination, not legal advice, and it is only as good as its inputs.');
  return determination.verdict === 'uncertain' ? 3 : 0;
}

// ------------------------------------------------------------------ claim ---

/**
 * VEX statuses a HUMAN may assert. `under_investigation` is deliberately not
 * here: that is the absence of a claim, and it is what the store already says
 * when nobody has signed anything.
 */
export type ClaimVerdict = 'not_affected' | 'affected' | 'fixed';

export interface ClaimBody extends Record<string, unknown> {
  product: string;
  cve: string;
  verdict: ClaimVerdict;
  rationale: string;
  declaredBy: string;
  assertion: string;
  fromHypothesisId?: string;
}

/**
 * Convert a hypothesis into a claim.
 *
 * This is the door the whole design is built around, and it was missing: every
 * finding sat permanently at under_investigation because nothing could write to
 * the claims stream. The boundary was enforced by having no way through it,
 * which is not the same as being enforced.
 *
 * A claim needs a NAME and, for not_affected, a REASON. VEX requires a
 * justification for not_affected specifically, and it is also the claim most
 * worth challenging: it is the one that discharges a duty.
 */
export function craClaim(
  io: CraIo,
  opts: {
    cve?: string;
    verdict?: string;
    by?: string;
    rationale?: string;
    supersedes?: string;
    json?: boolean;
  },
): number {
  const VERDICTS: ClaimVerdict[] = ['not_affected', 'affected', 'fixed'];
  if (!opts.cve || !opts.verdict || !opts.by) {
    io.error('Usage: legalithm cra claim --cve <CVE> --verdict <not_affected|affected|fixed> --by "<name>" [--rationale "..."]');
    return 1;
  }
  if (!VERDICTS.includes(opts.verdict as ClaimVerdict)) {
    io.error(`Unknown --verdict "${opts.verdict}". One of: ${VERDICTS.join(', ')}.`);
    io.error('under_investigation is not assertable: it is what the record says when nobody has signed.');
    return 1;
  }
  const verdict = opts.verdict as ClaimVerdict;
  if (verdict === 'not_affected' && !opts.rationale) {
    io.error('not_affected needs --rationale. It is the claim that discharges a duty, and VEX requires a justification for it.');
    return 1;
  }

  const cve = opts.cve.toUpperCase();
  const hypotheses = asOf(readStream<HypothesisBody>(io.cwd, 'hypotheses'));
  const match = hypotheses.find((h) => h.body.cve.toUpperCase() === cve);
  if (!match) {
    io.error(`No hypothesis for ${cve}. Run: legalithm cra watch`);
    return 1;
  }

  const body: ClaimBody = {
    product: match.body.product,
    cve,
    verdict,
    rationale: opts.rationale ?? '',
    declaredBy: opts.by,
    assertion: `${cve} is ${verdict} for this product version`,
    fromHypothesisId: match.id,
  };
  const { event, created } = append(io.cwd, 'claims', body, {
    now: io.now,
    ...(opts.supersedes ? { supersedes: opts.supersedes } : {}),
  });

  if (opts.json) {
    io.log(JSON.stringify({ claim: event.id, cve, verdict, declaredBy: opts.by, created }, null, 2));
    return 0;
  }
  io.log(created ? `Claim recorded: ${cve} is ${verdict}` : `Identical claim already recorded for ${cve}`);
  io.log(`  declared by  ${opts.by}`);
  io.log(`  from         hypothesis ${match.id.slice(0, 16)}`);
  io.log(`  claim        ${event.id.slice(0, 16)}`);
  if (verdict === 'not_affected') {
    io.log('');
    io.log('This discharges the finding for Annex I purposes. It does NOT withdraw an');
    io.log('Article 14 clock: reporting triggers on a vulnerability contained in the');
    io.log('product, not on whether it is reachable.');
  }
  io.log('');
  io.log('To change it later, supersede rather than edit:');
  io.log(`  legalithm cra claim --cve ${cve} --verdict <v> --by "<name>" --supersedes ${event.id.slice(0, 16)}`);
  return 0;
}

// ----------------------------------------------------------------- record ---

export interface CraRecord {
  schema: 'legalithm.cra.record/v0.4';
  generatedAt: string;
  asOf: string;
  instrument: 'Regulation (EU) 2024/2847';
  products: { product: string; name: string; version: string; productClass: string; route: string; supportUntil?: string }[];
  evidenceCount: number;
  /**
   * Machine findings. `machineVerdict` is what the analyser concluded;
   * `status` stays under_investigation until a named human signs it, because a
   * verdict nobody has put their name to is not a VEX statement you can
   * publish. Dropping machineVerdict would throw away the analysis in the one
   * artifact that gets handed over.
   */
  hypotheses: {
    cve: string;
    component: string;
    product: string;
    machineVerdict: 'not_affected' | 'affected' | 'under_investigation' | 'not_assessed';
    rationale?: string;
    callPath?: string[];
    /** The signed position, or under_investigation while nobody has signed. */
    status: 'under_investigation' | ClaimVerdict;
    signedBy: string | null;
    signedAt?: string;
    /**
     * What produced the machine finding. Carried into the record, and therefore
     * into `recordHash` and any signature over it, because provenance that only
     * exists in the local store is provenance the person receiving the record
     * cannot check.
     */
    provenance: HypothesisProvenance;
  }[];
  /**
   * Positions a named human has signed. THE load-bearing object: a hypothesis is
   * a machine's opinion and carries no weight, a claim is somebody's name against
   * a verdict.
   *
   * This carried only `assertion`, `declaredBy` and `declaredAt`, so the verdict,
   * the CVE and the reasoning stayed in the local store and never reached the
   * signed record. An auditor holding the record could see that somebody asserted
   * something, and not what they concluded or why. The claim is the thing the
   * whole format exists to carry; it cannot be the thinnest object in it.
   */
  claims: {
    cve: string;
    verdict: ClaimVerdict;
    assertion: string;
    rationale: string;
    declaredBy: string;
    declaredAt: string;
    /** The hypothesis this converted, when it came from one. */
    fromHypothesisId?: string;
  }[];
  openClocks: { article: string; cve: string; dueAt: string | null; deliverable: string }[];
  /** Article 14(8) duties to users that have not been discharged. */
  usersNotInformed: { reference: string; trigger: string }[];
  /**
   * The Article 13(8) support period, with the reasoning behind it.
   *
   * It can be recorded two ways and the record has to see both. `cra product
   * --support-until` puts a date on the product row; `cra support` writes to its
   * own stream with the declarant and the rationale Article 13(8) requires and
   * Annex VII (4) asks for in the technical file. The record read only the
   * product row, so a manufacturer who used `cra support`, the command that
   * actually captures the reasoning, produced a record with no support period in
   * it at all and a hash that did not move.
   *
   * `cra doc` already handled both paths. The record did not, which is the worse
   * place for the gap: a document can be regenerated, whereas the record is the
   * artifact somebody signs and relies on.
   *
   * Null means genuinely not determined, which is a live obligation rather than
   * an omission.
   */
  supportPeriod: { until: string; declaredBy: string; declaredAt: string; rationale?: string } | null;
  /**
   * The Article 13(2) risk assessment, pinned by the SHA-256 of its bytes.
   *
   * The seventh instance of one shape: written to a stream, read by `cra doc`,
   * and never read back into the record. `cra risk` pinned the document, the
   * technical file cited the pin, and the RECORD carried neither, so
   * `recordHash` did not cover it and the signature said nothing about which
   * assessment had been made. The determination for Annex I Part I (1) even
   * asserted the document was "pinned by content hash in the record", which was
   * not true of the record it was written into.
   *
   * The pin belongs here specifically because this is the signed artifact. With
   * it, rewriting the assessment after signing breaks the comparison against a
   * signed hash. Without it, the assessment could be replaced wholesale and
   * every signature would still verify.
   *
   * Null means no assessment has been recorded, which under Article 13(2) is an
   * unmet obligation rather than a missing field.
   */
  riskAssessment: {
    document: string;
    sha256: string;
    declaredBy: string;
    declaredAt: string;
    summary: string;
    /** The product version it was assessed ABOUT. Null for pre-scoping rows. */
    declaredForVersion: string | null;
    /** True when it was assessed about a different version than this record covers. */
    staleForThisVersion: boolean;
  } | null;
  /**
   * Part II governance documents, each pinned by the SHA-256 of its bytes.
   *
   * The same treatment `riskAssessment` gets, for the same reason. Part II asks
   * for a disclosure policy, a remediation policy and published advisories, and
   * every one of those is a document. A determination that cites a policy the
   * record does not pin is a determination whose evidence can be rewritten after
   * signing without breaking anything.
   *
   * An array rather than a field per kind: advisories accumulate, and the next
   * duty that needs a document should not require another schema version.
   */
  documents: {
    kind: string;
    document: string;
    sha256: string;
    declaredBy: string;
    declaredAt: string;
    summary: string;
    /** The product version it was recorded about. Null for pre-scoping rows. */
    declaredForVersion: string | null;
    /** True when recorded about a different version than this record covers. */
    staleForThisVersion: boolean;
  }[];
  /**
   * Annex I determinations, each attributed to the person who made it.
   *
   * These were written to the assessments stream and left out of the record
   * entirely, so `recordHash` did not cover them and `cra record --sign`
   * produced a signature over a document that omitted the conformity
   * determinations. Someone verifying that signature got integrity over the
   * component inventory and the machine findings, and nothing at all over the
   * twenty-two statements a named human had actually put their name to, which
   * are the part of the record with legal weight.
   *
   * `notAssessed` is carried explicitly rather than inferred from a short list,
   * because "we have not determined this yet" and "this requirement does not
   * appear in the record" read identically to a reader and mean very different
   * things to an auditor.
   */
  annexI: {
    determined: {
      ref: string;
      status: string;
      declaredBy: string;
      declaredAt: string;
      rationale?: string;
      /** The product version it was declared ABOUT. Null for pre-scoping rows. */
      declaredForVersion: string | null;
      /**
       * True when it was declared about a DIFFERENT version than this record
       * covers, or about no version at all.
       *
       * Carried rather than dropped, because deleting somebody's determination
       * is worse than showing it with a warning. But it must never read as a
       * current statement: nobody has said this about this version.
       */
      staleForThisVersion: boolean;
    }[];
    notAssessed: string[];
    /** Refs whose latest determination was made about another version. */
    determinedForAnotherVersion: string[];
  };
  recordHash: string;
  notice: string;
}

/**
 * Recompute a record's hash from the record ALONE.
 *
 * Verification has to work for someone holding `record.json`, the signature and
 * the public key, and nothing else: no evidence streams, no repository, no
 * network, and no dependence on Legalithm existing. Recomputing from the streams
 * would only prove the record matches a store the verifier does not have.
 *
 * Excludes exactly what `craRecord` excludes when it hashes: `recordHash`
 * itself, plus `generatedAt` and `asOf`, which are "the moment you ran it".
 * Including either would make two runs over identical evidence hash differently,
 * and the signature would be signing the clock.
 */
export function recomputeRecordHash(record: Record<string, unknown>): string {
  const { recordHash: _stored, generatedAt: _rendered, asOf: _viewedAt, ...hashable } = record;
  return contentHash(hashable);
}

export function craRecord(
  io: CraIo,
  opts: { asOf?: string; json?: boolean; signing?: boolean },
): { code: number; record?: CraRecord } {
  const cutoff = opts.asOf;
  const products = asOf(readStream<ProductBody>(io.cwd, 'products'), cutoff);
  if (products.length === 0) {
    io.error('Nothing to record. Register a product first.');
    return { code: 1 };
  }
  const evidence = asOf(readStream<EvidenceBody>(io.cwd, 'evidence'), cutoff);
  const hypotheses = asOf(readStream<HypothesisBody>(io.cwd, 'hypotheses'), cutoff);
  const claims = asOf(readStream<Record<string, unknown>>(io.cwd, 'claims'), cutoff);
  const clocks = asOf(readStream<ClockBody>(io.cwd, 'clocks'), cutoff);
  const now = (io.now ?? (() => new Date()))().toISOString();

  // Derived through buildAnnexIReport rather than re-walked here, so `cra
  // assess --gaps` and the record can never disagree about what is determined.
  const currentVersion = products[products.length - 1]?.body.version ?? null;
  /*
   * Which version each ref's LATEST determination was made about.
   *
   * Keyed by ref rather than joined inside buildAnnexIReport, because that
   * function is shared with `cra assess --gaps` and knows nothing about
   * products. Keeping the version lookup here means the gap report and the
   * record still agree on WHAT is determined, while only the record says which
   * version it was determined for.
   */
  const assessmentVersionByRef = new Map<string, string | null>();
  for (const a of asOf(readStream<AssessmentBody>(io.cwd, 'assessments'), cutoff)) {
    assessmentVersionByRef.set(a.body.ref, a.body.productVersion ?? null);
  }

  const annexIReport = buildAnnexIReport(
    asOf(readStream<AssessmentBody>(io.cwd, 'assessments'), cutoff).map((a) => ({
      ref: a.body.ref,
      status: a.body.status,
      declaredBy: a.body.declaredBy,
      declaredAt: a.observedAt,
      ...(a.body.rationale ? { rationale: a.body.rationale } : {}),
    })),
    [],
  );

  /*
   * Both recording paths, same rule `cra doc` already applies. The support
   * stream wins because it is the one that carries the declarant and the
   * rationale; the product row is the fallback for `cra product
   * --support-until`, which records a date and nothing else.
   */
  const supportRows = asOf(readStream<SupportBody>(io.cwd, 'support'), cutoff);
  const latestSupport = supportRows[supportRows.length - 1];
  const productSupportUntil = products[products.length - 1]?.body.supportUntil;
  const supportPeriod: CraRecord['supportPeriod'] = latestSupport
    ? {
        until: latestSupport.body.until,
        declaredBy: latestSupport.body.declaredBy,
        declaredAt: latestSupport.observedAt,
        ...(latestSupport.body.rationale ? { rationale: latestSupport.body.rationale } : {}),
      }
    : productSupportUntil
      ? {
          until: String(productSupportUntil),
          declaredBy: '',
          declaredAt: products[products.length - 1]!.observedAt,
        }
      : null;

  /*
   * Read from the same stream `cra doc` reads, at the same cutoff, so the
   * technical file and the record can never cite different assessments.
   */
  const riskRows = asOf(readStream<RiskBody>(io.cwd, 'risk'), cutoff);
  const latestRiskRow = riskRows[riskRows.length - 1];
  const riskAssessment: CraRecord['riskAssessment'] = latestRiskRow
    ? {
        document: latestRiskRow.body.document,
        sha256: latestRiskRow.body.documentHash,
        declaredBy: latestRiskRow.body.declaredBy,
        declaredAt: latestRiskRow.observedAt,
        summary: latestRiskRow.body.summary,
        declaredForVersion: latestRiskRow.body.productVersion ?? null,
        staleForThisVersion: (latestRiskRow.body.productVersion ?? null) !== currentVersion,
      }
    : null;

  /*
   * Every policy row, not just the latest: a superseded advisory is still an
   * advisory that was published, and Part II (4) is a duty about what WAS
   * disclosed. Collapsing to the newest would quietly unpublish history.
   */
  const documents: CraRecord['documents'] = asOf(readStream<PolicyBody>(io.cwd, 'policy'), cutoff).map((row) => ({
    kind: String(row.body.kind),
    document: row.body.document,
    sha256: row.body.documentHash,
    declaredBy: row.body.declaredBy,
    declaredAt: row.observedAt,
    summary: row.body.summary,
    declaredForVersion: row.body.productVersion ?? null,
    staleForThisVersion: (row.body.productVersion ?? null) !== currentVersion,
  }));

  const body: Omit<CraRecord, 'recordHash'> = {
    schema: 'legalithm.cra.record/v0.4',
    generatedAt: now,
    asOf: cutoff ?? now,
    instrument: 'Regulation (EU) 2024/2847',
    products: products.map((p) => ({
      product: productKey(p.body),
      name: p.body.name,
      version: p.body.version,
      productClass: p.body.productClass,
      route: CONFORMITY_ROUTE[p.body.productClass],
      ...(p.body.supportUntil ? { supportUntil: p.body.supportUntil } : {}),
    })),
    evidenceCount: evidence.length,
    // Every machine finding lands here, never in claims.
    hypotheses: hypotheses.map((h) => {
      // A claim upgrades the status; without one it stays under_investigation
      // however confident the machine was.
      const signed = claims.find(
        (c) => String((c.body as ClaimBody).cve).toUpperCase() === h.body.cve.toUpperCase(),
      );
      const claimBody = signed?.body as ClaimBody | undefined;
      return {
        cve: h.body.cve,
        component: h.body.component,
        product: h.body.product,
        machineVerdict: h.body.reachability?.status ?? ('not_assessed' as const),
        ...(claimBody?.rationale
          ? { rationale: claimBody.rationale }
          : h.body.reachability?.rationale
            ? { rationale: h.body.reachability.rationale }
            : {}),
        ...(h.body.reachability?.callPath ? { callPath: h.body.reachability.callPath } : {}),
        status: claimBody?.verdict ?? ('under_investigation' as const),
        signedBy: claimBody?.declaredBy ?? null,
        ...(signed ? { signedAt: signed.observedAt } : {}),
        // Older rows predate the field; say "unrecorded" rather than invent a
        // tool that did not necessarily produce them.
        provenance: h.body.provenance ?? {
          tool: 'unrecorded',
          toolVersion: 'unrecorded',
          model: null,
          promptVersion: null,
        },
      };
    }),
    claims: claims.map((c) => {
      const b = c.body as unknown as ClaimBody;
      return {
        cve: String(b.cve ?? ''),
        verdict: b.verdict,
        assertion: String(b.assertion ?? ''),
        rationale: String(b.rationale ?? ''),
        declaredBy: String(b.declaredBy ?? ''),
        declaredAt: c.observedAt,
        ...(b.fromHypothesisId ? { fromHypothesisId: b.fromHypothesisId } : {}),
      };
    }),
    /*
     * An Article 14(8) duty with no issuedAt is OPEN. Filing with the CSIRT
     * coordinator does not discharge it, so a record tracking only clocks
     * would show a manufacturer as done with a live duty to users outstanding.
     *
     * Grouped by reference, and discharged if ANY row for it carries an
     * issuedAt. The store is append-only, so drafting an advisory and later
     * recording that it was issued leaves two rows; counting rows rather than
     * duties reported the duty as open forever after it had been met. Once
     * users have been informed that is a historical fact, and a later draft
     * does not un-inform them.
     */
    usersNotInformed: Object.values(
      asOf(readStream<AdvisoryBody>(io.cwd, 'advisories'), cutoff).reduce<
        Record<string, { reference: string; trigger: string; informed: boolean }>
      >((acc, a) => {
        const ref = String(a.body.reference);
        const prior = acc[ref];
        acc[ref] = {
          reference: ref,
          trigger: String(a.body.trigger),
          informed: Boolean(prior?.informed) || Boolean(a.body.issuedAt),
        };
        return acc;
      }, {}),
    )
      .filter((a) => !a.informed)
      .map(({ reference, trigger }) => ({ reference, trigger })),
    openClocks: clocks
      // A null dueAt is Article 14(2)(c) waiting on a corrective measure. The
      // duty is OPEN, it simply has no deadline yet, so it stays listed.
      // Dropping it would hide an outstanding obligation behind a date filter.
      .filter((c) => c.body.dueAt === null || c.body.dueAt >= (cutoff ?? now))
      .map((c) => ({ article: c.body.article, cve: c.body.cve, dueAt: c.body.dueAt, deliverable: c.body.deliverable })),
    supportPeriod,
    riskAssessment,
    documents,
    annexI: {
      determined: annexIReport.requirements
        .filter((r) => r.status !== 'not_assessed')
        .map((r) => {
          const declaredForVersion = assessmentVersionByRef.get(r.ref) ?? null;
          return {
            ref: r.ref,
            status: r.status,
            declaredBy: String(r.declaredBy ?? ''),
            declaredAt: String(r.declaredAt ?? ''),
            ...(r.rationale ? { rationale: r.rationale } : {}),
            declaredForVersion,
            staleForThisVersion: declaredForVersion !== currentVersion,
          };
        }),
      notAssessed: annexIReport.gaps,
      determinedForAnotherVersion: annexIReport.requirements
        .filter((r) => r.status !== 'not_assessed')
        .filter((r) => (assessmentVersionByRef.get(r.ref) ?? null) !== currentVersion)
        .map((r) => r.ref),
    },
    notice:
      'This record states what was known and asserted as of the date above. It is evidence, ' +
      'not a declaration of conformity: conformity under Regulation (EU) 2024/2847 stays with ' +
      'the manufacturer. Findings shown as under_investigation are machine hypotheses and have ' +
      'not been confirmed by a named person.',
  };

  // The hash covers the CONTENT and nothing else. Both `generatedAt` and a
  // defaulted `asOf` are just "the moment you ran it", and including either
  // made two runs over identical evidence hash differently, which breaks
  // offline verification and makes a signature unreproducible. Identical
  // evidence must produce an identical hash, or the signature signs the clock.
  const { generatedAt: _rendered, asOf: _viewedAt, ...hashable } = body;
  const record: CraRecord = { ...body, recordHash: contentHash(hashable) };

  const path = join(io.cwd, CRA_DIR, 'record.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  if (opts.json) {
    io.log(JSON.stringify(record, null, 2));
    return { code: 0, record };
  }

  io.log(`CRA record as of ${record.asOf}`);
  io.log(`  products    ${record.products.length}`);
  io.log(`  evidence    ${record.evidenceCount}`);
  io.log(`  hypotheses  ${record.hypotheses.length} (under_investigation, not claims)`);
  io.log(`  claims      ${record.claims.length}`);
  io.log(`  open clocks ${record.openClocks.length}`);
  io.log(`  users not informed ${record.usersNotInformed.length} (Article 14(8), a duty to users, not to authorities)`);
  io.log(`  hash        ${record.recordHash.slice(0, 16)}`);
  if (record.annexI.determinedForAnotherVersion.length) {
    // Loud, because the alternative is a determination reading as current when
    // nobody has said it about this version.
    io.log('');
    io.log(
      `  ⚠ ${record.annexI.determinedForAnotherVersion.length} determination(s) were made about a DIFFERENT`,
    );
    io.log(`    version of this product, and are shown as stale rather than dropped:`);
    for (const ref of record.annexI.determinedForAnotherVersion.slice(0, 6)) {
      const d = record.annexI.determined.find((x) => x.ref === ref);
      io.log(`      ${ref} — declared for ${d?.declaredForVersion ?? 'no version'}`);
    }
    if (record.annexI.determinedForAnotherVersion.length > 6) {
      io.log(`      ... and ${record.annexI.determinedForAnotherVersion.length - 6} more`);
    }
    io.log('    Re-declare them against this version, or they say nothing about it.');
  }
  io.log(`  written     ${join(CRA_DIR, 'record.json')}`);
  io.log('');
  // Suppressed while signing: `cra record --sign` regenerates the record first,
  // so this told the user to sign a record they were in the middle of signing,
  // immediately above the line confirming it was signed.
  if (!opts.signing) {
    io.log('Sign it with your own key; Legalithm holds none:');
    io.log('  legalithm cra record --sign --key <path> --key-id <your-org>');
  }
  return { code: 0, record };
}

export type { StoreEvent };

/**
 * Draft an Article 14 report. Feature 5, minus the submission ENISA has not
 * specified.
 *
 * Both artifacts come from ONE record: a rendering for the person filing under
 * a 24 hour deadline, and an envelope that makes the eventual single reporting
 * platform integration a mapping exercise rather than a rebuild.
 */
export function craReport(
  io: CraIo,
  opts: {
    cve?: string;
    stage?: string;
    out?: string;
    remedyAt?: string;
    memberStates?: string;
    json?: boolean;
    /** Article 14(3)-(4): a severe incident rather than an exploited vulnerability. */
    incident?: boolean;
    /** When the 14(4)(b) incident notification was submitted. Starts the one-month clock. */
    notifiedAt?: string;
    suspectedMalicious?: boolean;
  },
): number {
  const STAGES: ReportStage[] = ['early-warning', 'vulnerability', 'final'];
  if (!opts.cve || !opts.stage) {
    io.error(`Usage: legalithm cra report --cve <CVE> --stage <${STAGES.join('|')}> [--out <dir>]`);
    io.error('  --member-states "DE,FR"   Article 14(2)(a) requires these where applicable');
    io.error('  --remedy-at <ISO date>    starts the Article 14(2)(c) 14-day clock');
    return 1;
  }
  if (!STAGES.includes(opts.stage as ReportStage)) {
    io.error(`Unknown --stage "${opts.stage}". One of: ${STAGES.join(', ')}`);
    return 1;
  }
  const stage = opts.stage as ReportStage;
  const track: ReportTrack = opts.incident ? 'incident' : 'vulnerability';
  const cve = opts.cve.toUpperCase();

  if (track === 'incident') {
    /*
     * A severe incident under Article 14(3) is not a CVE finding and does not
     * come out of `cra watch`. It is something a person observed, so there is
     * no hypothesis to draw on and no clock to check: the draft is a form to
     * fill, and refusing for lack of a finding would be wrong.
     */
    const ps = asOf(readStream<ProductBody>(io.cwd, 'products'));
    const last = ps[ps.length - 1];
    return emitReport(
      io,
      buildArticle14Report(stage, {
        track,
        cve,
        ...(last ? { product: { name: last.body.name, version: last.body.version } } : {}),
        awareAt: (io.now ?? (() => new Date()))().toISOString(),
        inKev: false,
        ...(opts.notifiedAt ? { incidentNotificationSubmittedAt: opts.notifiedAt } : {}),
        ...(opts.suspectedMalicious !== undefined
          ? { suspectedUnlawfulOrMalicious: opts.suspectedMalicious }
          : {}),
        ...(opts.memberStates
          ? { memberStates: opts.memberStates.split(',').map((x) => x.trim()).filter(Boolean) }
          : {}),
      }),
      opts,
      cve,
      stage,
    );
  }

  const hypotheses = asOf(readStream<HypothesisBody>(io.cwd, 'hypotheses'));
  const match = hypotheses.find((h) => h.body.cve.toUpperCase() === cve);
  if (!match) {
    io.error(`No finding for ${cve}. Article 14 reports are drafted from the record, not from nothing.`);
    io.error('Run: legalithm cra watch --kev <kev.json> --osv <dump>');
    return 1;
  }

  const clocks = asOf(readStream<ClockBody>(io.cwd, 'clocks')).filter(
    (c) => String(c.body.cve).toUpperCase() === cve,
  );
  if (clocks.length === 0) {
    io.error(`${cve} is recorded but carries no Article 14 clock, which means it is not`);
    io.error('recorded as actively exploited. Article 14(1) is triggered by an ACTIVELY');
    io.error('EXPLOITED vulnerability; a known but unexploited CVE has no reporting duty.');
    return 1;
  }

  const products = asOf(readStream<ProductBody>(io.cwd, 'products'));
  const product = products.find((p) => productKey(p.body) === match.body.product);

  const report = buildArticle14Report(stage, {
    cve,
    ...(product ? { product: { name: product.body.name, version: product.body.version } } : {}),
    // Awareness is when the record learned it, which is the defensible date.
    awareAt: match.recordedAt,
    ...(opts.remedyAt ? { remedyAvailableAt: opts.remedyAt } : {}),
    ...(match.body.basis ? { exploitationNote: String(match.body.basis) } : {}),
    inKev: true,
    ...(opts.memberStates
      ? { memberStates: opts.memberStates.split(',').map((x) => x.trim()).filter(Boolean) }
      : {}),
  });

  return emitReport(io, report, opts, cve, stage);
}

/** Shared by both Article 14 tracks: render, write, and report the gaps. */
function emitReport(
  io: CraIo,
  report: ReturnType<typeof buildArticle14Report>,
  opts: { out?: string; json?: boolean },
  cve: string,
  stage: ReportStage,
): number {
  if (opts.json) {
    io.log(JSON.stringify(reportEnvelope(report), null, 2));
    return report.complete ? 0 : 3;
  }

  const dir = opts.out ?? join(io.cwd, CRA_DIR, 'reports');
  mkdirSync(dir, { recursive: true });
  const base = `${cve}-${stage}`;
  writeFileSync(join(dir, `${base}.md`), renderArticle14Markdown(report), 'utf8');
  writeFileSync(join(dir, `${base}.json`), `${JSON.stringify(reportEnvelope(report), null, 2)}\n`, 'utf8');

  io.log(`${stage} draft for ${cve}`);
  io.log(`  basis    ${report.article}`);
  io.log(`  due      ${report.dueAt ?? 'not started'}`);
  io.log(`  rule     ${report.dueRule}`);
  io.log(`  items    ${report.fields.length}`);
  io.log(`  GAPS     ${report.gaps.length}`);
  io.log(`  written  ${join(dir, base)}.md and .json`);
  if (report.gaps.length) {
    io.log('');
    io.log('Gaps, each with its verbatim requirement in the file:');
    for (const g of report.gaps) io.log(`  ${g}`);
  }
  io.log('');
  io.log(`NOT SUBMITTED. Article 14(${report.article.includes('14(4)') ? '3' : '1'}) obliges the manufacturer to notify`);
  io.log('the CSIRT coordinator and ENISA through the Article 16 single reporting platform.');
  return report.complete ? 0 : 3;
}

export interface AdvisoryBody extends Record<string, unknown> {
  product: string;
  reference: string;
  trigger: AdvisoryTrigger;
  issuedAt: string | null;
}

/**
 * Article 14(8): draft the advisory that goes to USERS.
 *
 * Separate from `cra report`, which produces the filings for the CSIRT
 * coordinator and ENISA. Doing one does not discharge the other, and keeping
 * them as one command would have implied otherwise.
 */
export function craAdvise(
  io: CraIo,
  opts: {
    cve?: string;
    incident?: boolean;
    /** Semicolon-separated: mitigations contain commas naturally. */
    mitigation?: string;
    affectedVersions?: string;
    issuedAt?: string;
    out?: string;
    json?: boolean;
  },
): number {
  if (!opts.cve) {
    io.error('Usage: legalithm cra advise --cve <CVE|incident-ref> [--incident]');
    io.error('  --mitigation "a; b"       what users can deploy, semicolon separated');
    io.error('  --affected-versions "..."  which versions users should check');
    io.error('  --issued-at <date>         record that users HAVE been informed');
    return 1;
  }
  const reference = opts.cve.toUpperCase();
  const trigger: AdvisoryTrigger = opts.incident ? 'incident' : 'vulnerability';
  const now = (io.now ?? (() => new Date()))();

  const products = asOf(readStream<ProductBody>(io.cwd, 'products'));
  const hypotheses = asOf(readStream<HypothesisBody>(io.cwd, 'hypotheses'));
  const match = hypotheses.find((h) => String(h.body.cve).toUpperCase() === reference);

  // On the vulnerability track the record knows when we became aware. For an
  // incident nobody recorded a finding, so awareness is now.
  const awareAt = match ? match.recordedAt : now.toISOString();
  const product = match
    ? products.find((p) => productKey(p.body) === match.body.product)
    : products[products.length - 1];

  const advisory = buildUserAdvisory(
    {
      trigger,
      reference,
      ...(product ? { product: { name: product.body.name, version: product.body.version } } : {}),
      awareAt,
      ...(opts.mitigation
        ? { userMitigations: opts.mitigation.split(';').map((m) => m.trim()).filter(Boolean) }
        : {}),
      ...(opts.affectedVersions
        ? { affectedVersions: opts.affectedVersions.split(',').map((v) => v.trim()).filter(Boolean) }
        : {}),
      ...(opts.issuedAt ? { issuedAt: opts.issuedAt } : {}),
    },
    now,
  );

  // Recorded either way. An outstanding duty is a fact about the product, and
  // the record is worth less if it only holds the things that went well.
  append<AdvisoryBody>(
    io.cwd,
    'advisories',
    {
      product: product ? productKey(product.body) : 'unknown',
      reference,
      trigger,
      issuedAt: opts.issuedAt ?? null,
    },
    { now: io.now },
  );

  if (opts.json) {
    io.log(JSON.stringify(advisoryEnvelope(advisory), null, 2));
    return advisory.complete ? 0 : 3;
  }

  const dir = opts.out ?? join(io.cwd, CRA_DIR, 'advisories');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${reference}.md`), renderAdvisoryMarkdown(advisory), 'utf8');
  writeFileSync(join(dir, `${reference}.json`), `${JSON.stringify(advisoryEnvelope(advisory), null, 2)}\n`, 'utf8');

  io.log(`User advisory draft for ${reference}`);
  io.log(`  basis    Article 14(8)`);
  io.log(`  items    ${advisory.fields.length}`);
  io.log(`  GAPS     ${advisory.gaps.length}`);
  io.log(`  written  ${join(dir, reference)}.md and .json`);
  io.log('');
  io.log(advisory.timeliness.message);
  if (advisory.gaps.length) {
    io.log('');
    io.log('Gaps, each with its verbatim requirement in the file:');
    for (const g of advisory.gaps) io.log(`  ${g}`);
  }
  return advisory.complete ? 0 : 3;
}

// ------------------------------------------------------- supplier network ---

/**
 * Verify an attestation's signature against the key carried inside it.
 *
 * Registered under a throwaway id so checking a file never mutates the caller's
 * trust store: an attestation arriving from outside must not be able to bind a
 * key id in the verifier that checks it.
 */
function verifyAttestationSignature(
  hash: string,
  sig: { algorithm: 'Ed25519'; keyId: string; signature: string },
  publicKeyPem: string,
): boolean {
  const probeId = `${sig.keyId}.__attestation-check`;
  registerVerificationKey(probeId, publicKeyPem);
  return verifyDetachedSignature(hash, { ...sig, keyId: probeId });
}

/** `cra supplier request` — ask a supplier about one component and one CVE. */
export function craSupplierRequest(
  io: CraIo,
  opts: { component?: string; componentVersion?: string; cve?: string; by?: string; out?: string },
): number {
  if (!opts.component || !opts.cve || !opts.by) {
    io.error('Usage: legalithm cra supplier request --component <name> --component-version <v> --cve <CVE> --by "<your org>" [--out <path>]');
    io.error('--by names who is asking, so the supplier can decline. It is NOT copied');
    io.error('into their answer: the answer is about the component, so it stays reusable.');
    return 1;
  }
  const request = buildRequest({
    component: opts.component,
    componentVersion: opts.componentVersion ?? 'unknown',
    cve: opts.cve,
    requestedBy: opts.by,
    now: (io.now ?? (() => new Date()))(),
  });
  const out = opts.out ?? join(io.cwd, `attestation-request-${request.component}-${request.cve}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(request, null, 2)}\n`, 'utf8');

  // Recorded so `cra supplier status` can tell you what is still outstanding.
  // Asking is an event worth keeping even if the answer never comes: "we asked
  // on 16 August and heard nothing" is itself evidence of due diligence.
  append<RequestBody>(
    io.cwd,
    'requests',
    {
      component: request.component,
      componentVersion: request.componentVersion,
      cve: request.cve,
      requestedBy: request.requestedBy,
    },
    { now: io.now },
  );

  io.log(`Request written: ${out}`);
  io.log(`  ${request.component} ${request.componentVersion} / ${request.cve}`);
  io.log('');
  io.log('Send it to the supplier by whatever channel you already use. There is no');
  io.log('account for them to create and nothing of ours in between. They answer with:');
  io.log('  legalithm cra supplier attest --request <this file> --verdict <not_affected|affected|fixed> \\');
  io.log('    --rationale "..." --by "<person>" --org "<company>" --key <their key> --key-id <their id>');
  return 0;
}

/** `cra supplier attest` — the supplier's signed, reusable answer. */
export function craSupplierAttest(
  io: CraIo,
  opts: {
    request?: string;
    verdict?: string;
    rationale?: string;
    by?: string;
    org?: string;
    key?: string;
    keyId?: string;
    out?: string;
  },
): number {
  if (!opts.request || !opts.verdict || !opts.rationale || !opts.by || !opts.org || !opts.key || !opts.keyId) {
    io.error('Usage: legalithm cra supplier attest --request <path> --verdict <not_affected|affected|fixed>');
    io.error('  --rationale "why" --by "<person>" --org "<company>" --key <path> --key-id <your id>');
    io.error('');
    io.error('You sign with YOUR key and you keep the file. It is reusable: the same');
    io.error('answer is worth the same to the next manufacturer who asks.');
    return 1;
  }
  if (!ATTESTATION_VERDICTS.includes(opts.verdict as AttestationVerdict)) {
    io.error(`Unknown verdict "${opts.verdict}". Use one of: ${ATTESTATION_VERDICTS.join(', ')}.`);
    return 1;
  }
  if (!existsSync(opts.request)) {
    io.error(`No request at ${opts.request}`);
    return 1;
  }

  let request: AttestationRequest;
  try {
    request = JSON.parse(readFileSync(opts.request, 'utf8')) as AttestationRequest;
  } catch (e) {
    io.error(`Could not read the request: ${(e as Error).message}`);
    return 1;
  }

  const body = buildAttestationBody({
    request,
    verdict: opts.verdict as AttestationVerdict,
    rationale: opts.rationale,
    declaredBy: opts.by,
    organisation: opts.org,
    now: (io.now ?? (() => new Date()))(),
  });

  let attestation: SignedAttestation;
  try {
    const key = loadSigningKey(readFileSync(opts.key, 'utf8'));
    const hash = attestationHash(body);
    attestation = {
      body,
      attestationHash: hash,
      signature: signRecordHash(hash, key, opts.keyId),
      publicKey: publicKeyPemFor(key),
    };
  } catch (e) {
    io.error((e as Error).message);
    return 1;
  }

  const out = opts.out ?? join(io.cwd, `attestation-${body.component}-${body.cve}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');

  io.log(`Attestation written: ${out}`);
  io.log(`  ${body.component} ${body.componentVersion} / ${body.cve} -> ${body.verdict}`);
  io.log(`  signed by ${sourceIdentity(body)} under "${opts.keyId}"`);
  io.log('');
  io.log('It names no requester, so hand the same file to anyone who asks the same');
  io.log('question. Keep it: it is yours, not theirs.');
  return 0;
}

/** `cra supplier verify` — check an attestation from the file alone. */
export function craSupplierVerify(io: CraIo, opts: { file?: string }): number {
  if (!opts.file) {
    io.error('Usage: legalithm cra supplier verify <attestation.json>');
    return 1;
  }
  if (!existsSync(opts.file)) {
    io.error(`No attestation at ${opts.file}`);
    return 1;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(opts.file, 'utf8'));
  } catch (e) {
    io.error(`Could not read it: ${(e as Error).message}`);
    return 1;
  }

  const checked = checkAttestation(parsed, verifyAttestationSignature);
  if (!checked.ok) {
    io.error(`✗ ${checked.reason}`);
    return 1;
  }
  const b = checked.body;
  io.log('✓ Attestation verifies.');
  io.log(`  ${b.component} ${b.componentVersion} / ${b.cve} -> ${b.verdict}`);
  io.log(`  ${sourceIdentity(b)}, ${b.declaredAt}`);
  io.log(`  rationale: ${b.rationale}`);
  io.log('');
  io.log(`This proves possession of key "${checked.keyId}", not who holds it.`);
  io.log('Confirm the key with the supplier out of band before relying on the name.');
  return 0;
}

/**
 * `cra supplier discover` — who to ask, derived from what is already on disk.
 *
 * Reads installed manifests. It does NOT ask a registry, because a per-package
 * lookup would disclose the whole dependency list to that registry, which is the
 * same leak the local OSV join exists to avoid.
 */
export function craSupplierDiscover(
  io: CraIo,
  opts: { modules?: string; product?: string; json?: boolean },
): number {
  const evidence = asOf(readStream<EvidenceBody>(io.cwd, 'evidence'));
  if (evidence.length === 0) {
    io.error('No evidence ingested. Run: legalithm cra ingest --sbom <path>');
    return 1;
  }
  const modules = opts.modules ?? join(io.cwd, 'node_modules');
  if (!existsSync(modules)) {
    io.error(`No installed modules at ${modules}.`);
    io.error('Pass --modules <path>. Contacts are read from manifests on disk, never');
    io.error('from a registry: one lookup per package would hand your dependency list over.');
    return 1;
  }

  const components = [...new Set(evidence.map((e) => e.body.component))]
    .filter((c) => c !== NO_COMPONENTS)
    .sort();

  const contacts: SupplierContact[] = components.map((c) => {
    const manifest = join(modules, c, 'package.json');
    if (!existsSync(manifest)) {
      return { component: c, repository: null, issues: null, author: null, route: null, gap: 'not installed here, so no manifest to read' };
    }
    try {
      return contactFromManifest(c, JSON.parse(readFileSync(manifest, 'utf8')));
    } catch {
      return { component: c, repository: null, issues: null, author: null, route: null, gap: 'manifest unreadable' };
    }
  });

  if (opts.json) {
    io.log(JSON.stringify(contacts, null, 2));
    return 0;
  }

  const routable = contacts.filter((c) => c.route);
  const gaps = contacts.filter((c) => !c.route);
  io.log(`${routable.length} of ${contacts.length} component(s) can be routed. No network was used.`);
  io.log('');
  for (const c of routable.slice(0, 40)) io.log(`  ${c.component.padEnd(28)} ${c.route}`);
  if (routable.length > 40) io.log(`  ... and ${routable.length - 40} more (--json for all)`);
  if (gaps.length) {
    io.log('');
    io.log(`${gaps.length} cannot be routed from local data:`);
    for (const c of gaps.slice(0, 10)) io.log(`  ${c.component.padEnd(28)} ${c.gap}`);
    if (gaps.length > 10) io.log(`  ... and ${gaps.length - 10} more`);
    io.log('');
    io.log('An unroutable component is a gap, not a guess. A wrong address is worse');
    io.log('than a missing one, because it looks like you asked.');
  }
  return 0;
}

/** `cra supplier status` — what was asked, what came back, what is still open. */
export function craSupplierStatus(io: CraIo, opts: { json?: boolean }): number {
  const requests = asOf(readStream<RequestBody>(io.cwd, 'requests'));
  if (requests.length === 0) {
    io.log('No supplier requests recorded. Ask one with: legalithm cra supplier request --component <n> --cve <CVE> --by "<your org>"');
    return 0;
  }

  // Answers come from ingested attestations, which are evidence.
  const answers = asOf(readStream<EvidenceBody>(io.cwd, 'evidence'))
    .filter((e) => e.body.sourceType === 'attestation' && e.body.attestation)
    .map((e) => {
      const a = e.body.attestation as { cve: string; declaredBy: string };
      return { component: e.body.component, cve: a.cve, declaredBy: a.declaredBy };
    });

  const rows = summariseRequests(
    requests.map((r) => ({ body: r.body, observedAt: r.observedAt })),
    answers,
    (io.now ?? (() => new Date()))(),
  );

  if (opts.json) {
    io.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  const open = rows.filter((r) => !r.answered);
  io.log(`${rows.length} asked, ${rows.length - open.length} answered, ${open.length} outstanding.`);
  io.log('');
  for (const r of rows) {
    const mark = r.answered ? '✓' : ' ';
    const tail = r.answered ? `answered by ${r.answeredBy}` : `${r.ageDays}d outstanding`;
    io.log(`  ${mark} ${r.component.padEnd(24)} ${r.cve.padEnd(18)} ${tail}`);
  }
  if (open.length) {
    io.log('');
    io.log('An unanswered request is not a failure to record. "We asked on this date');
    io.log('and heard nothing" is itself evidence of due diligence under Annex I Part II.');
  }
  // Non-zero would make this unusable in a script that just wants the picture.
  return 0;
}

// ------------------------------------------------------- risk assessment ---

export interface RiskBody extends Record<string, unknown> {
  /** Path to the assessment, relative to the store. */
  document: string;
  /**
   * SHA-256 of the document's bytes.
   *
   * The record binds to the CONTENT, not the filename. Without this, the
   * assessment could be rewritten after the record was signed and the signature
   * would still verify: the record would attest that an assessment existed,
   * while saying nothing about what it said. Article 13(3) requires the
   * assessment to be documented, and a document you cannot pin is not one.
   */
  documentHash: string;
  declaredBy: string;
  /** One line, for the technical file. The document carries the substance. */
  summary: string;
  productVersion: string;
}

/**
 * A governance document the record binds to by content.
 *
 * Part II asks for policies and advisories, which are documents rather than
 * code. Naming one in a rationale and leaving it unpinned would repeat the
 * mistake the risk assessment already taught: a record that says a policy exists
 * while saying nothing about what it said, and a signature that survives the
 * policy being rewritten afterwards.
 */
export interface PolicyBody extends Record<string, unknown> {
  /** What Part II duty this document discharges. */
  kind: PolicyKind;
  /** Path to the document, relative to the store. */
  document: string;
  /** SHA-256 of the document's bytes. The record binds to CONTENT, not filename. */
  documentHash: string;
  declaredBy: string;
  /** One line. The document carries the substance. */
  summary: string;
  productVersion: string;
}

export const POLICY_KINDS = ['cvd_policy', 'vulnerability_handling', 'advisory'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** `cra policy` — record a Part II governance document and pin its content. */
export function craPolicy(
  io: CraIo,
  opts: { document?: string; kind?: string; by?: string; summary?: string },
): number {
  if (!opts.document || !opts.kind || !opts.by || !opts.summary) {
    io.error('Usage: legalithm cra policy --document <path> --kind <kind> --by "<name>" --summary "<one line>"');
    io.error('');
    io.error(`  --kind  ${POLICY_KINDS.join(' | ')}`);
    io.error('');
    io.error('Annex I Part II asks for a coordinated vulnerability disclosure policy (5),');
    io.error('remediation without delay (2), published advisories about fixed');
    io.error('vulnerabilities (4), and advisory messages with disseminated updates (8).');
    io.error('Those are documents. This records that one exists and pins its content.');
    io.error('It does not write it: a policy nobody decided is worse than none.');
    return 1;
  }
  if (!(POLICY_KINDS as readonly string[]).includes(opts.kind)) {
    io.error(`Unknown --kind "${opts.kind}". One of: ${POLICY_KINDS.join(', ')}`);
    return 1;
  }
  // Resolve against the STORE, for the reason craRisk documents below.
  const documentPath = isAbsolute(opts.document) ? opts.document : join(io.cwd, opts.document);
  if (!existsSync(documentPath)) {
    io.error(`No document at ${documentPath}`);
    return 1;
  }
  const products = asOf(readStream<ProductBody>(io.cwd, 'products'));
  if (products.length === 0) {
    io.error('No product registered. A policy is recorded about a product version.');
    return 1;
  }
  const product = products[products.length - 1]!.body;
  const documentHash = createHash('sha256').update(readFileSync(documentPath)).digest('hex');

  append<PolicyBody>(
    io.cwd,
    'policy',
    {
      kind: opts.kind as PolicyKind,
      document: opts.document.replace(/^\.\//, ''),
      documentHash,
      declaredBy: opts.by,
      summary: opts.summary,
      productVersion: product.version,
    },
    { now: io.now },
  );

  io.log(`Policy recorded for ${product.name} ${product.version}`);
  io.log(`  kind         ${opts.kind}`);
  io.log(`  document     ${opts.document}`);
  io.log(`  sha256       ${documentHash.slice(0, 32)}`);
  io.log(`  declared by  ${opts.by}`);
  io.log('');
  io.log('The record pins this document by content. Rewriting it after signing');
  io.log('breaks the comparison, and `cra record --verify` fails rather than');
  io.log('reporting a signature over a policy that has since changed.');
  return 0;
}

/** `cra risk` — record the Article 13(2) cybersecurity risk assessment. */
export function craRisk(
  io: CraIo,
  opts: { document?: string; by?: string; summary?: string },
): number {
  if (!opts.document || !opts.by || !opts.summary) {
    io.error('Usage: legalithm cra risk --document <path> --by "<name>" --summary "<one line>"');
    io.error('');
    io.error('Article 13(2) requires an assessment of the cybersecurity risks, and 13(3)');
    io.error('requires it documented: intended purpose, reasonably foreseeable use,');
    io.error('conditions of use, assets protected, expected time in use, and whether and');
    io.error('how each Annex I Part I (2) requirement applies.');
    io.error('');
    io.error('This command records that one exists and pins its content. It does not');
    io.error('write it: an assessment nobody performed is worse than none.');
    return 1;
  }
  /*
   * Resolve against the STORE, not the process.
   *
   * This used `existsSync(opts.document)` directly, so a relative path was
   * resolved against process.cwd() while the record and the technical file both
   * resolve against io.cwd. They agree whenever a user runs the CLI from the
   * repository root and disagree everywhere else, which is exactly the kind of
   * bug that passes a manual test and fails for somebody else.
   */
  const documentPath = isAbsolute(opts.document) ? opts.document : join(io.cwd, opts.document);
  if (!existsSync(documentPath)) {
    io.error(`No assessment at ${documentPath}`);
    return 1;
  }
  const products = asOf(readStream<ProductBody>(io.cwd, 'products'));
  if (products.length === 0) {
    io.error('No product registered. A risk assessment is about a product version.');
    return 1;
  }
  const product = products[products.length - 1]!.body;

  const bytes = readFileSync(documentPath);
  const documentHash = createHash('sha256').update(bytes).digest('hex');

  append<RiskBody>(
    io.cwd,
    'risk',
    {
      document: opts.document.replace(/^\.\//, ''),
      documentHash,
      declaredBy: opts.by,
      summary: opts.summary,
      productVersion: product.version,
    },
    { now: io.now },
  );

  io.log(`Risk assessment recorded for ${product.name} ${product.version}`);
  io.log(`  document     ${opts.document}`);
  io.log(`  sha256       ${documentHash.slice(0, 32)}`);
  io.log(`  declared by  ${opts.by}`);
  io.log('');
  io.log('The record now pins the document\'s content, so an assessment rewritten');
  io.log('after signing no longer matches what was signed. Re-record it when it');
  io.log('changes: Article 13(3) requires it updated during the support period.');
  return 0;
}
