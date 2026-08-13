import { describe, expect, it } from 'vitest';

import { explainObligationTool } from '../tools.js';

/**
 * `explain_obligation` gained a jurisdiction block. Three responses have to stay
 * distinguishable, and two of them look alike from the outside:
 *
 *   caller did not ask            -> no block at all
 *   asked about an unmapped state -> block with mapped: false and a reason
 *   asked about Germany           -> block with the competent authority
 *
 * Collapsing the middle case into the first is the dangerous one. "No
 * enforcement block for France" and "no enforcement block because nobody asked"
 * would be the same bytes, and an agent reading the response could conclude no
 * authority is competent in France. What is true is narrower: Legalithm has not
 * mapped France. That is a fact about this corpus, not about French law.
 */

describe('the caller did not ask about a country', () => {
  it('returns the obligations with no enforcement block, exactly as before', () => {
    const out = explainObligationTool('deployer', 'high');
    expect(out.items.length).toBeGreaterThan(0);
    expect(out).not.toHaveProperty('enforcement');
  });

  it('is unchanged when an empty jurisdiction object is passed', () => {
    expect(explainObligationTool('deployer', 'high', {})).not.toHaveProperty('enforcement');
  });
});

describe('the caller asked about a state with no source on file', () => {
  const out = explainObligationTool('deployer', 'high', { country: 'FR' });

  it('says so explicitly rather than staying silent', () => {
    expect(out.enforcement?.mapped).toBe(false);
  });

  it('says the gap is ours, not that France has no regulator', () => {
    const note = out.enforcement && 'note' in out.enforcement ? out.enforcement.note : '';
    expect(note).toMatch(/not yet mapped/i);
    expect(note).toMatch(/NOT that no authority is competent/i);
  });

  it('still returns the EU-wide obligations, which do not depend on the state', () => {
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items).toEqual(explainObligationTool('deployer', 'high').items);
  });
});

describe('the caller asked about Germany', () => {
  it('names the Bundesnetzagentur for an ordinary company', () => {
    const out = explainObligationTool('deployer', 'high', { country: 'DE' });
    expect(out.enforcement?.mapped).toBe(true);
    const names = out.enforcement && 'competentAuthorities' in out.enforcement
      ? out.enforcement.competentAuthorities.map((a) => a.shortName)
      : [];
    expect(names).toEqual(['BNetzA']);
  });

  it('names BaFin for a bank, and not the default authority', () => {
    const out = explainObligationTool('deployer', 'high', {
      country: 'DE',
      sector: 'financial_services',
    });
    const names = out.enforcement && 'competentAuthorities' in out.enforcement
      ? out.enforcement.competentAuthorities.map((a) => a.shortName)
      : [];
    expect(names).toEqual(['BaFin']);
    expect(names).not.toContain('BNetzA');
  });

  it('sends a broadcaster to its Land, and not to the default authority', () => {
    const out = explainObligationTool('deployer', 'high', { country: 'DE', sector: 'media' });
    const names = out.enforcement && 'competentAuthorities' in out.enforcement
      ? out.enforcement.competentAuthorities.map((a) => a.shortName)
      : [];
    expect(names).toEqual(['Land']);
    expect(names).not.toContain('BNetzA');
  });

  it('accepts a lowercase country code and reports it normalised', () => {
    const out = explainObligationTool('deployer', 'high', { country: 'de' });
    expect(out.enforcement?.country).toBe('DE');
  });

  it('carries the national implementing law and its in-force date', () => {
    const out = explainObligationTool('deployer', 'high', { country: 'DE' });
    const law = out.enforcement && 'nationalLaw' in out.enforcement
      ? out.enforcement.nationalLaw
      : undefined;
    expect(law?.shortName).toBe('KI-MIG');
    expect(law?.inForce).toBe('2026-07-29');
  });

  it('keeps KoKIVO out of the authorities and in support bodies', () => {
    const out = explainObligationTool('deployer', 'high', { country: 'DE' });
    if (!out.enforcement || !('competentAuthorities' in out.enforcement)) throw new Error('no block');
    expect(out.enforcement.competentAuthorities.map((a) => a.shortName)).not.toContain('KoKIVO');
    expect(out.enforcement.supportBodies.map((a) => a.shortName)).toEqual(['KoKIVO']);
  });

  it('passes the quote and confidence through, so a caller can hedge', () => {
    // The Länder carve-out is one source deep on the media example. A consumer
    // that cannot see that would state it as firmly as the BaFin designation.
    const media = explainObligationTool('deployer', 'high', { country: 'DE', sector: 'media' });
    const bank = explainObligationTool('deployer', 'high', {
      country: 'DE',
      sector: 'financial_services',
    });
    const first = (o: typeof media) =>
      o.enforcement && 'competentAuthorities' in o.enforcement
        ? o.enforcement.competentAuthorities[0]
        : undefined;

    expect(first(media)?.confidence).toBe('medium');
    expect(first(bank)?.confidence).toBe('high');
    expect(first(bank)?.sourceQuote).toContain('Bafin');
  });
});
