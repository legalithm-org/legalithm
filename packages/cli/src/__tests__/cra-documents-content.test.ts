import { describe, it, expect } from 'vitest';
import { generateDocument, renderDocumentMarkdown, type DocumentFacts } from '../cra/documents.js';

/**
 * What the generators put into a technical file when the record HAS something,
 * as against when it has nothing.
 *
 * Every item is a branch: fill it from the record, or emit a GAP. Only the
 * empty side was covered, so the side that actually writes into an Article 31
 * document was untested. That is the side with consequences: a generator that
 * writes the wrong thing is worse than one that writes nothing, because a GAP
 * is visible and a wrong sentence is not.
 */
const empty: DocumentFacts = {
  evidenceCount: 0,
  annexIStatus: {},
  annexIAssessed: 0,
  annexITotal: 22,
  openFindings: 0,
  asOf: '2026-08-15',
};

const full: DocumentFacts = {
  ...empty,
  product: { name: 'Acme Gateway', version: '2.4.0', productClass: 'default', supportUntil: '2032-01-01' },
  evidenceCount: 304,
  annexIAssessed: 22,
  conformityRoute: 'Article 32(1): self-assessment',
  notifiedBodyNumber: '1234',
  openFindings: 3,
};

describe('the technical file fills what it holds and gaps the rest', () => {
  it('is all gaps with an empty record', () => {
    const d = generateDocument('technical-documentation', empty);
    expect(d.complete).toBe(false);
    expect(d.gaps.length).toBeGreaterThan(4);
  });

  it('fills the product, SBOM and Annex I items when the record holds them', () => {
    const d = generateDocument('technical-documentation', full);
    const by = Object.fromEntries(d.sections.map((s) => [s.ref, s.content]));
    expect(by['Annex VII (1)']).toContain('Acme Gateway');
    expect(by['Annex VII (2)']).toContain('304');
    expect(by['Annex VII (3)']).toContain('22 of 22');
    expect(by['Annex VII (4)']).toContain('2032-01-01');
    expect(by['Annex VII (8)']).toContain('SBOM');
  });

  it('never claims a presumption of conformity, since no standard is cited', () => {
    const d = generateDocument('technical-documentation', full);
    const s = d.sections.find((x) => x.ref === 'Annex VII (5)')!;
    expect(s.content).toContain('no presumption of conformity');
  });

  it('still reports gaps even on a full record, because some items are prose', () => {
    const d = generateDocument('technical-documentation', full);
    expect(d.gaps).toContain('Annex VII (7)');
  });
});

describe('the declaration refuses to write the parts a person signs', () => {
  it('leaves identity, responsibility and signature as gaps even when full', () => {
    const d = generateDocument('declaration-of-conformity', full);
    for (const ref of ['Annex V (2)', 'Annex V (3)']) {
      expect(d.gaps, `${ref} is the signer's to write`).toContain(ref);
    }
  });

  it('names the notified body when one is recorded', () => {
    const d = generateDocument('declaration-of-conformity', full);
    expect(d.sections.find((s) => s.ref === 'Annex V (7)')!.content).toContain('1234');
  });

  it('states self-assessment when the class is default and no body is involved', () => {
    const { notifiedBodyNumber: _drop, ...noBody } = full;
    const d = generateDocument('declaration-of-conformity', noBody as DocumentFacts);
    expect(d.sections.find((s) => s.ref === 'Annex V (7)')!.content).toContain('self-assessment');
  });

  it('gaps the notified body for a class that needs one', () => {
    const { notifiedBodyNumber: _drop, ...noBody } = full;
    const d = generateDocument('declaration-of-conformity', {
      ...(noBody as DocumentFacts),
      product: { name: 'G', version: '1', productClass: 'important_class_ii' },
    });
    expect(d.gaps).toContain('Annex V (7)');
  });
});

describe('rendering', () => {
  it('marks every gap visibly and attributes every filled item to its source', () => {
    const md = renderDocumentMarkdown(generateDocument('technical-documentation', full));
    expect(md).toContain('**GAP');
    expect(md).toContain('_source:');
    expect(md).toContain('Article 31');
  });

  it('says the declaration is not a declaration until signed', () => {
    const md = renderDocumentMarkdown(generateDocument('declaration-of-conformity', full));
    expect(md).toContain('sole responsibility');
    expect(md).toContain('not a declaration until');
  });

  it('renders without a product at all', () => {
    const md = renderDocumentMarkdown(generateDocument('technical-documentation', empty));
    expect(md).not.toContain('Product:');
  });
});
