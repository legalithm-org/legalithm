/**
 * A technical file is read by a compliance manager, an auditor, or a notified
 * body, and markdown is the wrong artifact for all three.
 *
 * The constraint that shaped this: `legalithm` installs one package and no
 * third-party code, which is asserted in the record as an Annex I determination
 * and checked by installing the published tarball. Bundling a PDF engine would
 * trade a signed determination for a file format, so the CLI emits
 * self-contained print HTML and drives a converter the machine already has.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderDocumentHtml, type GeneratedDocument } from '../cra/documents.js';
import { findConverter, htmlToPdf, CONVERTERS } from '../cra/to-pdf.js';

const doc = (over: Partial<GeneratedDocument> = {}): GeneratedDocument =>
  ({
    kind: 'technical-documentation',
    instrument: 'Regulation (EU) 2024/2847',
    basis: 'Article 31 and Annex VII',
    corpusVersion: '1.0.0',
    product: { name: 'Acme Gateway', version: '2.4.0', productClass: 'default' },
    sections: [
      { ref: 'Annex VII (1)', requirement: 'a general description', content: 'Acme Gateway 2.4.0', source: 'cra product' },
      { ref: 'Annex VII (6)', requirement: 'a copy of the EU declaration', content: null, source: null },
    ],
    gaps: ['Annex VII (6)'],
    complete: false,
    notice: 'Working draft assembled from the evidence store.',
    ...over,
  }) as GeneratedDocument;

describe('the printable technical file', () => {
  it('is self-contained: no external stylesheet, font, script or image', () => {
    const html = renderDocumentHtml(doc());
    // It has to render identically on a machine with no network in 2031, which
    // is the same reason the record format is published.
    expect(html).not.toMatch(/<link[^>]+href=["']http/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/src=["']https?:/i);
  });

  it('carries print rules a browser can act on', () => {
    const html = renderDocumentHtml(doc());
    expect(html).toContain('@page');
    expect(html).toContain('A4');
    // A heading must never be the last thing on a page.
    expect(html).toMatch(/break-after:\s*avoid/);
    expect(html).toMatch(/break-inside:\s*avoid-page/);
  });

  // The bug this caught in the real document: `cra product --support-until`
  // printed as an em-dash, and a printed page cannot be copy-pasted.
  it('disables ligatures wherever a command is shown', () => {
    const html = renderDocumentHtml(doc());
    expect(html).toMatch(/font-variant-ligatures:\s*none/);
    expect(html).toMatch(/"liga" 0/);
  });

  it('marks a gap as deliberate rather than missing', () => {
    const html = renderDocumentHtml(doc());
    expect(html).toContain('is-gap');
    expect(html).toMatch(/GAP/);
    expect(html).toMatch(/left\s+empty on purpose/);
    expect(html).toMatch(/manufacturing evidence/);
  });

  it('escapes content rather than letting a record inject markup', () => {
    const html = renderDocumentHtml(
      doc({
        sections: [
          { ref: '<img src=x onerror=alert(1)>', requirement: 'r & r', content: '"<b>bold</b>"', source: null },
        ],
      } as Partial<GeneratedDocument>),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
  });

  it('states the gap count where a reader lands, not buried', () => {
    const html = renderDocumentHtml(doc());
    const head = html.slice(0, html.indexOf('<section'));
    expect(head).toMatch(/1 of 2 items are gaps/);
  });
});

describe('the PDF converter', () => {
  it('prefers a real browser over cupsfilter, which ignores print CSS', () => {
    const order = CONVERTERS.map((c) => c.id);
    expect(order.indexOf('cupsfilter')).toBe(order.length - 1);
    expect(CONVERTERS.find((c) => c.id === 'cupsfilter')!.degraded).toBe(true);
  });

  it('uses the first converter present', () => {
    const found = findConverter({ which: (b) => b === 'weasyprint' });
    expect(found?.id).toBe('weasyprint');
  });

  // The important path: a user with nothing installed must still get a document
  // and be told exactly what to do, not a stack trace.
  it('says what to do when nothing is installed', () => {
    const r = htmlToPdf('/tmp/a.html', '/tmp/a.pdf', { which: () => false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/print it to PDF/i);
    expect(r.reason).toMatch(/weasyprint|wkhtmltopdf|chromium/);
  });

  it('reports a converter that failed rather than claiming success', () => {
    const r = htmlToPdf('/tmp/a.html', '/tmp/a.pdf', {
      which: (b) => b === 'weasyprint',
      run: () => ({ status: 3, stdout: Buffer.from('') }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('exited 3');
  });

  it('flags a degraded conversion instead of passing it off as good', () => {
    const r = htmlToPdf('/tmp/a.html', '/tmp/a.pdf', {
      which: (b) => b === 'cupsfilter',
      run: () => ({ status: 0, stdout: Buffer.from('%PDF-1.4') }),
    });
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
  });
});

describe('the real document this repository ships', () => {
  it('renders with ligatures disabled and no external references', () => {
    const html = readFileSync(
      join(process.cwd(), 'compliance/cra/technical-documentation.html'),
      'utf8',
    );
    expect(html).toMatch(/font-variant-ligatures:\s*none/);
    expect(html).not.toMatch(/src=["']https?:/i);
    expect(html).toContain('--support-until');
  });
});
