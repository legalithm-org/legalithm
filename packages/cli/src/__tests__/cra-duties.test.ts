/**
 * `cra classify` computed the role from the day it shipped, and nothing used it.
 * An importer who ran the tool learned they were an importer and was handed a
 * manufacturer's Annex I checklist: the one answer worse than none, because it
 * is long, wrong, and every item on it is somebody else's duty.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dutiesFor, effectiveRoles } from '../cra/duties.js';

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('the duties that attach to a role', () => {
  it('gives an importer Article 19, all five paragraphs', () => {
    const refs = dutiesFor(ROOT, 'importer').obligations.map((o) => o.ref);
    for (const p of [1, 2, 3, 4, 5]) {
      expect(refs, `Article 19(${p}) missing`).toContain(`Article 19(${p})`);
    }
  });

  it('gives a distributor Article 20, all five paragraphs', () => {
    const refs = dutiesFor(ROOT, 'distributor').obligations.map((o) => o.ref);
    for (const p of [1, 2, 3, 4, 5]) {
      expect(refs, `Article 20(${p}) missing`).toContain(`Article 20(${p})`);
    }
  });

  // The failure that matters: handing an importer the manufacturer's list.
  it('does not give an importer the manufacturer duties', () => {
    const refs = dutiesFor(ROOT, 'importer').obligations.map((o) => o.ref);
    expect(refs.some((r) => r.startsWith('Annex I'))).toBe(false);
    expect(refs).not.toContain('Article 13(1)');
  });

  it('keeps the two roles distinct', () => {
    const imp = dutiesFor(ROOT, 'importer').obligations.map((o) => o.ref);
    const dis = dutiesFor(ROOT, 'distributor').obligations.map((o) => o.ref);
    expect(imp).not.toContain('Article 20(1)');
    expect(dis).not.toContain('Article 19(1)');
  });
});

describe('Article 21 reassignment', () => {
  // A white-labeller who is shown a short list has been told the most
  // dangerous possible thing.
  it('makes a rebranding importer a manufacturer as well', () => {
    const plain = dutiesFor(ROOT, 'importer');
    const rebrand = dutiesFor(ROOT, 'importer', { rebrandsOrModifies: true });

    expect(plain.reassigned).toBe(false);
    expect(rebrand.reassigned).toBe(true);
    expect(rebrand.applied).toEqual(['importer', 'manufacturer']);
    expect(rebrand.obligations.length).toBeGreaterThan(plain.obligations.length * 5);
    expect(rebrand.obligations.map((o) => o.ref)).toContain('Article 13(1)');
  });

  it('does not reassign a manufacturer, who is already one', () => {
    expect(effectiveRoles('manufacturer', true)).toEqual(['manufacturer']);
  });

  it('does not reassign without the trigger', () => {
    expect(effectiveRoles('distributor', false)).toEqual(['distributor']);
  });
});

describe('the corpus behind it', () => {
  it('holds every paragraph of Articles 19 and 20, verbatim', () => {
    const collapse = (s: string) => s.split(/\s+/).join(' ').trim();
    const oj = collapse(readFileSync(join(ROOT, 'corpus/eu-cra/source/oj-excerpt.txt'), 'utf8'));
    const yml = readFileSync(join(ROOT, 'corpus/eu-cra/obligations.yml'), 'utf8');

    // The source was truncated: 19(5) held three characters, 20(5) stopped
    // mid-sentence. Both were recovered, and this fails if either regresses.
    expect(oj).toContain('Importers shall, further to a reasoned request from a market surveillance authority');
    expect(oj).toContain('They shall cooperate with that authority, at its request, on any measures taken');

    for (const ref of ['19(2)', '19(3)', '19(4)', '19(5)', '20(2)', '20(3)', '20(4)', '20(5)']) {
      expect(yml, `Article ${ref} not authored`).toContain(`ref: 'Article ${ref}'`);
    }
  });
});
