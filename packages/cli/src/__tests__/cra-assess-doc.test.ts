import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craAssess, craDoc, type CraIo } from '../cra/commands.js';
import { annexIRequirements, buildAnnexIReport, annexIComplete } from '../cra/assess.js';
import { generateDocument, renderDocumentMarkdown } from '../cra/documents.js';
import { readStream } from '../cra/store.js';

let cwd: string;
let out: string[];
let err: string[];
let io: CraIo;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ad-'));
  out = [];
  err = [];
  io = { cwd, log: (m) => out.push(m), error: (m) => err.push(m) };
  craProduct(io, { name: 'Acme Gateway', version: '2.4.0', productClass: 'important_class_ii' });
  out = [];
});

describe('Annex I assessment (feature 6)', () => {
  it('knows all 22 requirements, 14 in Part I and 8 in Part II', () => {
    const r = annexIRequirements();
    expect(r).toHaveLength(22);
    expect(r.filter((x) => x.part === 'I')).toHaveLength(14);
    expect(r.filter((x) => x.part === 'II')).toHaveLength(8);
  });

  /** A gap report whose default is "fine" is worse than no report. */
  it('defaults every requirement to not_assessed, never to met', () => {
    const rep = buildAnnexIReport([], []);
    expect(rep.counts.not_assessed).toBe(22);
    expect(rep.counts.met).toBe(0);
    expect(rep.gaps).toHaveLength(22);
    expect(annexIComplete(rep)).toBe(false);
  });

  it('only a named human moves a requirement to met', () => {
    const rep = buildAnnexIReport(
      [{ ref: 'Annex I Part I (2)(a)', status: 'met', declaredBy: 'Pedram', declaredAt: '2026-08-14T00:00:00Z', rationale: 'r' }],
      [],
    );
    const row = rep.requirements.find((r) => r.ref === 'Annex I Part I (2)(a)')!;
    expect(row.status).toBe('met');
    expect(row.declaredBy).toBe('Pedram');
    expect(rep.counts.not_assessed).toBe(21);
  });

  it('evidence alone never changes a status', () => {
    const rep = buildAnnexIReport([], [{ ref: 'Annex I Part I (2)(a)' }, { ref: 'Annex I Part I (2)(a)' }]);
    const row = rep.requirements.find((r) => r.ref === 'Annex I Part I (2)(a)')!;
    expect(row.evidenceCount).toBe(2);
    expect(row.status).toBe('not_assessed');
  });

  it('the latest determination wins', () => {
    const rep = buildAnnexIReport(
      [
        { ref: 'Annex I Part I (1)', status: 'met', declaredBy: 'A', declaredAt: '2026-01-01T00:00:00Z', rationale: 'r' },
        { ref: 'Annex I Part I (1)', status: 'not_met', declaredBy: 'B', declaredAt: '2026-06-01T00:00:00Z' },
      ],
      [],
    );
    expect(rep.requirements.find((r) => r.ref === 'Annex I Part I (1)')!.status).toBe('not_met');
  });

  it('refuses met without a rationale, and refuses an unknown ref', () => {
    expect(craAssess(io, { ref: 'Annex I Part I (1)', status: 'met', by: 'X' })).toBe(1);
    expect(err.join('\n')).toContain('--rationale');
    expect(craAssess(io, { ref: 'Nope', status: 'met', by: 'X', rationale: 'r' })).toBe(1);
    expect(readStream(cwd, 'assessments')).toHaveLength(0);
  });

  it('refuses not_assessed as an assertion', () => {
    expect(craAssess(io, { ref: 'Annex I Part I (1)', status: 'not_assessed', by: 'X' })).toBe(1);
    expect(err.join('\n')).toContain('not assertable');
  });

  it('exits 3 while anything is undetermined', () => {
    expect(craAssess(io, {})).toBe(3);
  });
});

describe('Annex VII and Annex V generators (features 7 and 8)', () => {
  const facts = {
    product: { name: 'Acme', version: '1.0', productClass: 'default' },
    evidenceCount: 3,
    annexIStatus: {},
    annexIAssessed: 0,
    annexITotal: 22,
    openFindings: 0,
    asOf: '2026-08-14T00:00:00Z',
  };

  it('covers all 8 items of each annex', () => {
    expect(generateDocument('technical-documentation', facts).sections).toHaveLength(8);
    expect(generateDocument('declaration-of-conformity', facts).sections).toHaveLength(8);
  });

  /**
   * The whole point. An item the record cannot support is a GAP, not generated
   * prose. Filling it would be manufacturing evidence.
   */
  it('emits gaps rather than inventing content', () => {
    const doc = generateDocument('technical-documentation', { ...facts, evidenceCount: 0 });
    expect(doc.gaps.length).toBeGreaterThan(0);
    expect(doc.complete).toBe(false);
    for (const s of doc.sections) {
      if (doc.gaps.includes(s.ref)) expect(s.content).toBeNull();
      expect(s.requirement.length).toBeGreaterThan(20);
    }
  });

  /** The declaration is signed under the manufacturer's sole responsibility. */
  it('never writes the identity, the conformity statement or the signature', () => {
    const doc = generateDocument('declaration-of-conformity', facts);
    for (const ref of ['Annex V (2)', 'Annex V (3)', 'Annex V (5)', 'Annex V (8)']) {
      expect(doc.sections.find((s) => s.ref === ref)!.content, `${ref} must stay unwritten`).toBeNull();
    }
    expect(doc.notice).toContain('sole responsibility');
  });

  it('states the standards position rather than claiming a presumption', () => {
    const tf = generateDocument('technical-documentation', facts);
    expect(tf.sections.find((s) => s.ref === 'Annex VII (5)')!.content).toContain('no presumption of conformity');
  });

  it('fills the notified body item only when it is genuinely not applicable', () => {
    const selfAssessed = generateDocument('declaration-of-conformity', facts);
    expect(selfAssessed.sections.find((s) => s.ref === 'Annex V (7)')!.content).toContain('Not applicable');
    const classII = generateDocument('declaration-of-conformity', {
      ...facts,
      product: { ...facts.product, productClass: 'important_class_ii' },
    });
    expect(classII.sections.find((s) => s.ref === 'Annex V (7)')!.content).toBeNull();
  });

  it('renders markdown carrying the verbatim requirement beside each gap', () => {
    const md = renderDocumentMarkdown(generateDocument('technical-documentation', { ...facts, evidenceCount: 0 }));
    expect(md).toContain('GAP — not held');
    expect(md).toContain('Annex VII (1)');
    expect(md).toContain('> '); // the quoted requirement
  });

  it('writes the draft to disk and exits 3 while gaps remain', () => {
    writeFileSync(join(cwd, 'sbom.json'), JSON.stringify({ components: [{ name: 'zlib', version: '1.3.1' }] }));
    craIngest(io, { sbom: join(cwd, 'sbom.json') });
    expect(craDoc(io, { type: 'technical-file' })).toBe(3);
    const p = join(cwd, 'compliance', 'cra', 'technical-documentation.md');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('Article 31 and Annex VII');
  });

  it('rejects an unknown document type', () => {
    expect(craDoc(io, { type: 'invoice' })).toBe(1);
  });
});
