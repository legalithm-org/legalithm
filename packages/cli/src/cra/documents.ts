/**
 * The two documents the CRA actually requires you to hand over: features 7 and 8.
 *
 *   Annex VII  the technical documentation, required by Article 31
 *   Annex V    the EU declaration of conformity, required by Article 28
 *
 * WHAT THESE GENERATORS DO NOT DO: write your compliance for you. Each item is
 * assembled from what the record already knows, and anything the record does
 * not know is emitted as an explicit GAP with the item's verbatim requirement
 * next to it. A generator that filled those in with plausible prose would be
 * manufacturing evidence, which is the one thing a compliance tool must never
 * do — and for the declaration specifically, the manufacturer signs it under
 * their sole responsibility, so an invented line is their liability, not ours.
 *
 * The output is therefore a WORKING DRAFT with holes, not a finished file. That
 * is the honest artifact. Article 31 requires the file kept for 10 years after
 * placing on the market or the support period, whichever is longer, and a file
 * padded with generated filler is worse than a short one with named gaps.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AnnexItem {
  ref: string;
  description: string;
}

interface DataFile {
  instrument: string;
  corpusVersion: string;
  annexVii: AnnexItem[];
  annexV: AnnexItem[];
}

let cached: DataFile | null = null;
function data(): DataFile {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  cached = JSON.parse(
    readFileSync(join(here, '..', '..', 'data', 'cra-annex-i.json'), 'utf8'),
  ) as DataFile;
  return cached;
}

export interface DocumentSection {
  ref: string;
  requirement: string;
  /** What the record could supply, or null when it is a gap. */
  content: string | null;
  source?: string;
}

export interface GeneratedDocument {
  kind: 'technical-documentation' | 'declaration-of-conformity';
  instrument: string;
  basis: string;
  corpusVersion: string;
  product?: { name: string; version: string; productClass: string };
  sections: DocumentSection[];
  gaps: string[];
  complete: boolean;
  notice: string;
}

export interface DocumentFacts {
  product?: { name: string; version: string; productClass: string; supportUntil?: string };
  /** Number of SBOM/attestation rows held. */
  evidenceCount: number;
  /** Annex I determinations: ref -> status. */
  annexIStatus: Record<string, string>;
  annexIAssessed: number;
  annexITotal: number;
  conformityRoute?: string;
  notifiedBodyNumber?: string;
  /** Reachability/vulnerability findings that are still open. */
  openFindings: number;
  /** The Article 13(2) assessment, when one is recorded. */
  riskAssessment?: { document: string; documentHash: string; declaredBy: string; summary: string };
  recordHash?: string;
  asOf: string;
}

const NOT_KNOWN = null;

function technicalFileContent(item: AnnexItem, f: DocumentFacts): { content: string | null; source?: string } {
  const p = f.product;
  switch (item.ref) {
    case 'Annex VII (1)':
      return p
        ? { content: `${p.name}, version ${p.version}. Product class: ${p.productClass}.`, source: 'cra product' }
        : { content: NOT_KNOWN };
    case 'Annex VII (2)':
      return f.evidenceCount > 0
        ? {
            content: `Software bill of materials held: ${f.evidenceCount} component assertion(s) recorded in the evidence store. Design, development and vulnerability handling narrative NOT recorded.`,
            source: 'cra ingest',
          }
        : { content: NOT_KNOWN };
    case 'Annex VII (3)': {
      const r = f.riskAssessment;
      if (r) {
        // Article 13(4) puts the assessment IN the technical documentation, so
        // it is cited by content hash rather than by filename. A path alone
        // would let the document change under a file that claims to hold it.
        return {
          content:
            `Cybersecurity risk assessment: ${r.document} (sha256 ${r.documentHash.slice(0, 16)}), ` +
            // The summary is free text a person typed, so it may or may not end
            // in a full stop. Without this the next sentence runs into it.
            `assessed by ${r.declaredBy}. ${/[.!?]$/.test(r.summary.trim()) ? r.summary.trim() : `${r.summary.trim()}.`} ` +
            `Annex I determinations recorded for ${f.annexIAssessed} of ${f.annexITotal} requirements.`,
          source: 'cra risk',
        };
      }
      return f.annexIAssessed > 0
        ? {
            content: `Annex I determinations recorded for ${f.annexIAssessed} of ${f.annexITotal} requirements. A cybersecurity risk assessment document is NOT held.`,
            source: 'cra assess',
          }
        : { content: NOT_KNOWN };
    }
    case 'Annex VII (4)':
      return p?.supportUntil
        ? { content: `Support period ends ${p.supportUntil}.`, source: 'cra product --support-until' }
        : { content: NOT_KNOWN };
    case 'Annex VII (5)':
      return {
        content:
          'No CRA harmonised standard is cited in the Official Journal, so no presumption of conformity is claimed and this item requires a description of the solutions adopted instead.',
        source: 'corpus/eu-cra/standards.yml',
      };
    case 'Annex VII (7)':
      return { content: NOT_KNOWN };
    case 'Annex VII (8)':
      return f.evidenceCount > 0
        ? { content: 'SBOM is generable from the evidence store on request.', source: 'cra ingest' }
        : { content: NOT_KNOWN };
    default:
      return { content: NOT_KNOWN };
  }
}

function declarationContent(item: AnnexItem, f: DocumentFacts): { content: string | null; source?: string } {
  const p = f.product;
  switch (item.ref) {
    case 'Annex V (1)':
      return p ? { content: `${p.name}, version ${p.version}`, source: 'cra product' } : { content: NOT_KNOWN };
    case 'Annex V (4)':
      return p ? { content: `${p.name} ${p.version}`, source: 'cra product' } : { content: NOT_KNOWN };
    case 'Annex V (6)':
      return {
        content:
          'No harmonised standard cited in the Official Journal for Regulation (EU) 2024/2847; no presumption of conformity relied upon.',
        source: 'corpus/eu-cra/standards.yml',
      };
    case 'Annex V (7)':
      return f.notifiedBodyNumber
        ? { content: `Notified body ${f.notifiedBodyNumber}. ${f.conformityRoute ?? ''}`.trim(), source: 'cra product' }
        : p && p.productClass === 'default'
          ? { content: 'Not applicable: self-assessment under Article 32(1), no notified body involved.', source: 'cra classify' }
          : { content: NOT_KNOWN };
    default:
      // 2 (name and address), 3 (sole responsibility statement), 5 (conformity
      // statement) and 8 (signature block) are the manufacturer's to write and
      // to sign. Generating them would be putting words in the signer's mouth.
      return { content: NOT_KNOWN };
  }
}

export function generateDocument(
  kind: GeneratedDocument['kind'],
  facts: DocumentFacts,
): GeneratedDocument {
  const d = data();
  const items = kind === 'technical-documentation' ? d.annexVii : d.annexV;
  const fill = kind === 'technical-documentation' ? technicalFileContent : declarationContent;

  const sections: DocumentSection[] = items.map((item) => {
    const { content, source } = fill(item, facts);
    return { ref: item.ref, requirement: item.description, content, ...(source ? { source } : {}) };
  });

  const gaps = sections.filter((s) => s.content === null).map((s) => s.ref);

  return {
    kind,
    instrument: d.instrument,
    basis: kind === 'technical-documentation' ? 'Article 31 and Annex VII' : 'Article 28 and Annex V',
    corpusVersion: d.corpusVersion,
    ...(facts.product
      ? { product: { name: facts.product.name, version: facts.product.version, productClass: facts.product.productClass } }
      : {}),
    sections,
    gaps,
    complete: gaps.length === 0,
    notice:
      kind === 'technical-documentation'
        ? 'Working draft assembled from the evidence store. Items shown as GAP are not held and must be written; nothing here is generated prose standing in for evidence. Article 31 requires this file for 10 years after placing on the market, or the support period, whichever is longer.'
        : 'Working draft. The declaration is issued under the sole responsibility of the manufacturer (Annex V (3)), so the identity, the conformity statement and the signature are deliberately left for a person to write and sign. This is not a declaration until they do.',
  };
}

export function renderDocumentMarkdown(doc: GeneratedDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.kind === 'technical-documentation' ? 'Technical documentation' : 'EU declaration of conformity'}`);
  lines.push('');
  lines.push(`${doc.instrument} — ${doc.basis}`);
  if (doc.product) lines.push(`Product: ${doc.product.name} ${doc.product.version} (${doc.product.productClass})`);
  lines.push(`Corpus version ${doc.corpusVersion}`);
  lines.push('');
  lines.push(`**${doc.gaps.length} of ${doc.sections.length} items are gaps.**`);
  lines.push('');
  for (const s of doc.sections) {
    lines.push(`## ${s.ref}`);
    lines.push('');
    lines.push(`> ${s.requirement}`);
    lines.push('');
    lines.push(s.content ? s.content : '**GAP — not held. This must be written by the manufacturer.**');
    if (s.source) lines.push('');
    if (s.source) lines.push(`_source: ${s.source}_`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(doc.notice);
  return `${lines.join('\n')}\n`;
}

/**
 * Print-ready HTML, for the reader who has to hand this to somebody.
 *
 * A technical file is read by a compliance manager, an auditor, or eventually a
 * notified body, and markdown is the wrong artifact for all three. Every
 * competitor emits PDF.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS BUNDLE A PDF LIBRARY. `legalithm`
 * installs one package and no third-party code, that is asserted in the record
 * as an Annex I determination, and it is checked by installing the published
 * tarball. Trading a signed determination for a file format would be a poor
 * bargain, so this emits self-contained HTML with print CSS: every browser and
 * every operating system already turns that into a PDF, and `cra doc` will
 * drive a converter the user already has if it finds one.
 *
 * No external stylesheet, font or image. The document has to render identically
 * on a machine with no network in 2031, which is the same reason the record
 * format is published.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDocumentHtml(doc: GeneratedDocument, meta: { generatedAt: string } = { generatedAt: '' }): string {
  const title = doc.kind === 'technical-documentation' ? 'Technical documentation' : 'EU declaration of conformity';
  const product = doc.product ? `${doc.product.name} ${doc.product.version}` : 'No product registered';

  const sections = doc.sections
    .map((s) => {
      const body = s.content
        ? `<p class="content">${escapeHtml(s.content)}</p>`
        : `<p class="gap"><strong>GAP — not held.</strong> This must be written by the manufacturer. It is left
             empty on purpose: filling it with generated prose would be manufacturing evidence.</p>`;
      const source = s.source ? `<p class="source">source: ${escapeHtml(s.source)}</p>` : '';
      return `<section class="item${s.content ? '' : ' is-gap'}">
        <h2>${escapeHtml(s.ref)}</h2>
        <blockquote>${escapeHtml(s.requirement)}</blockquote>
        ${body}
        ${source}
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — ${escapeHtml(product)}</title>
<style>
  /* A4 with a running footer. Margins are generous because this gets printed,
     bound, and read on paper by somebody who did not choose to be there. */
  @page { size: A4; margin: 22mm 20mm 20mm; }
  :root { --ink: #111; --muted: #555; --rule: #d4d4d8; --gap: #92400e; --gapbg: #fffbeb; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; max-width: 42em; padding: 2rem 1.5rem;
    font: 11pt/1.55 Georgia, "Times New Roman", serif; color: var(--ink);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 1rem; margin-bottom: 1.5rem; }
  h1 { font-size: 20pt; margin: 0 0 .4rem; letter-spacing: -0.01em; }
  .meta { color: var(--muted); font-size: 9.5pt; line-height: 1.7; }
  .meta strong { color: var(--ink); }
  .summary {
    margin: 1.2rem 0 0; padding: .6rem .8rem; border-left: 3px solid var(--ink);
    background: #fafafa; font-size: 10pt;
  }
  /* A heading must never be the last thing on a page. */
  h2 { font-size: 12pt; margin: 0 0 .5rem; break-after: avoid; page-break-after: avoid; }
  .item { margin: 0 0 1.6rem; break-inside: avoid-page; page-break-inside: avoid; }
  blockquote {
    margin: 0 0 .7rem; padding: .5rem .8rem; border-left: 2px solid var(--rule);
    color: var(--muted); font-size: 9.5pt; font-style: italic;
  }
  .content { margin: 0; }
  .gap { margin: 0; padding: .6rem .8rem; background: var(--gapbg); border-left: 3px solid var(--gap); color: var(--gap); }
  /* Ligatures OFF. The mono stack fuses a double hyphen into one em-dash glyph,
     so a flag printed as an em-dash and a printed document is the one place a
     reader cannot copy the text instead of retyping it. */
  .source {
    margin: .35rem 0 0; color: var(--muted); font-size: 8.5pt;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0;
  }
  footer { margin-top: 2rem; padding-top: .8rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: 9pt; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">
    <strong>${escapeHtml(doc.instrument)}</strong> — ${escapeHtml(doc.basis)}<br>
    Product: <strong>${escapeHtml(product)}</strong>${doc.product ? ` (${escapeHtml(doc.product.productClass)})` : ''}<br>
    Corpus version ${escapeHtml(doc.corpusVersion)}${meta.generatedAt ? ` · generated ${escapeHtml(meta.generatedAt.slice(0, 10))}` : ''}
  </p>
  <p class="summary"><strong>${doc.gaps.length} of ${doc.sections.length} items are gaps.</strong>
  A gap is a deliberate blank, not an omission: it is content only the manufacturer can supply.</p>
</header>
${sections}
<footer>${escapeHtml(doc.notice)}</footer>
</body>
</html>
`;
}
