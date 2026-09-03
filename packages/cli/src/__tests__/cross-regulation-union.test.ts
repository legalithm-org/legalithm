import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
  normalise, loadFramework, whichApply, sharedWork, rolesIn, runApplies,
  KNOWN_ABSENT, type FrameworkKey, type UnifiedObligation,
} from '../union.js';

/**
 * G9: the union across regulations. "A connected medical device faces the CRA,
 * the MDR, the AI Act if it has a model in it, and the EAA if it has a user
 * interface. Nobody sells the union."
 *
 * The engine was never the blocker — `lib/corpus/frameworks.ts` already loads
 * several corpora. What blocked it is that the packs do not share a shape, and
 * that the same actor has a different NAME in each instrument.
 *
 * That second one produced a real bug on the first run: filtering on the literal
 * string `manufacturer` returned ZERO AI Act obligations, because the AI Act
 * calls that party a `provider`. Zero reads as "this instrument asks nothing of
 * you", which is the worst answer a compliance tool can give.
 */
const REPO = join(__dirname, '..', '..', '..', '..');
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: REPO, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });
const said = () => out.join('\n');

describe('normalising three packs that do not share a shape', () => {
  it('builds a citable ref for the AI Act pack, which has none', () => {
    // Flat schema: role/risk/article as columns, no `ref`, no `dimensions`.
    const rows = normalise('eu-ai-act', [
      { id: 'risk_management', role: 'provider', risk: 'high', article: '9', evidence_type: 'document', title: 'Risk management system' },
    ]);
    expect(rows[0]!.ref).toBe('Article 9');
    expect(rows[0]!.role).toBe('provider');
    expect(rows[0]!.instrument).toBe('Regulation (EU) 2024/1689');
  });

  it('reads role out of `dimensions` for the corpus-shaped packs', () => {
    const rows = normalise('eu-cra', [
      { ref: 'Article 13(1)', title: 'Essential requirements', evidence_type: 'process', dimensions: { role: 'manufacturer' } },
    ]);
    expect(rows[0]!.role).toBe('manufacturer');
    expect(rows[0]!.ref).toBe('Article 13(1)');
  });

  it('loads all three real corpora from the working tree', () => {
    const cra = loadFramework(REPO, 'eu-cra');
    const eaa = loadFramework(REPO, 'eu-eaa');
    const ai = loadFramework(REPO, 'eu-ai-act');
    expect(cra.length).toBeGreaterThan(100);
    expect(eaa.length).toBeGreaterThan(200);
    expect(ai.length).toBeGreaterThan(40);
  });
});

describe('the same actor has a different name in each instrument', () => {
  it('maps a CRA manufacturer to an AI Act provider', () => {
    expect(rolesIn('manufacturer', 'eu-ai-act')).toEqual(['provider']);
    expect(rolesIn('manufacturer', 'eu-cra')).toEqual(['manufacturer']);
    expect(rolesIn('provider', 'eu-cra')).toEqual(['manufacturer']);
  });

  it('does NOT fold deployer into manufacturer', () => {
    // An AI Act deployer is the party USING a system. Folding it in would
    // attribute duties to the wrong party, which is a legal error and not a
    // vocabulary one.
    expect(rolesIn('manufacturer', 'eu-ai-act')).not.toContain('deployer');
    expect(rolesIn('deployer', 'eu-cra')).toBeNull();
  });

  it('never narrows to zero when a role has no counterpart', () => {
    // open_source_steward is a CRA concept with no EAA equivalent. The answer is
    // "not narrowed", never "no obligations".
    expect(rolesIn('open_source_steward', 'eu-eaa')).toBeNull();

    const corpora = {
      'eu-cra': loadFramework(REPO, 'eu-cra'),
      'eu-eaa': loadFramework(REPO, 'eu-eaa'),
      'eu-ai-act': loadFramework(REPO, 'eu-ai-act'),
    } as Record<FrameworkKey, UnifiedObligation[]>;

    const v = whichApply(
      { digitalElements: true, aiSystem: false, userInterface: true, role: 'open_source_steward' },
      corpora,
    );
    const eaa = v.find((x) => x.framework === 'eu-eaa')!;
    expect(eaa.obligations).toBeGreaterThan(0);
    expect(eaa.because).toContain('no counterpart here');
  });

  it('the regression: a manufacturer sees AI Act obligations, not zero', () => {
    const corpora = {
      'eu-cra': loadFramework(REPO, 'eu-cra'),
      'eu-eaa': loadFramework(REPO, 'eu-eaa'),
      'eu-ai-act': loadFramework(REPO, 'eu-ai-act'),
    } as Record<FrameworkKey, UnifiedObligation[]>;

    const v = whichApply({ digitalElements: true, aiSystem: true, userInterface: true, role: 'manufacturer' }, corpora);
    const ai = v.find((x) => x.framework === 'eu-ai-act')!;
    expect(ai.applies).toBe(true);
    expect(
      ai.obligations,
      'zero here reads as "the AI Act asks nothing of you", which is how this bug shipped',
    ).toBeGreaterThan(0);
  });
});

describe('what the union says, and what it refuses to say', () => {
  it('groups the work by evidence type across every applicable framework', () => {
    const corpora = {
      'eu-cra': loadFramework(REPO, 'eu-cra'),
      'eu-eaa': loadFramework(REPO, 'eu-eaa'),
      'eu-ai-act': loadFramework(REPO, 'eu-ai-act'),
    } as Record<FrameworkKey, UnifiedObligation[]>;
    const profile = { digitalElements: true, aiSystem: true, userInterface: true, role: 'manufacturer' };
    const groups = sharedWork(whichApply(profile, corpora), corpora, profile);

    const docs = groups.find((g) => g.evidenceType === 'document')!;
    expect(docs.perFramework.map((p) => p.framework).sort()).toEqual(['eu-ai-act', 'eu-cra', 'eu-eaa']);
    expect(docs.total).toBeGreaterThan(0);
  });

  it('refuses to imply one artifact discharges obligations in two regulations', () => {
    out.length = 0;
    expect(runApplies(io(), { digitalElements: true, ai: true, ui: true, role: 'manufacturer' })).toBe(0);
    // The single most expensive claim this product could make. Asserted per
    // line, because the disclaimer wraps across several log calls.
    expect(said()).toContain('NOT the same obligation');
    expect(said()).toContain('discharged by the same artifact');
    expect(said()).toContain('determination is still made separately');
  });

  it('names the regulations it cannot answer for', () => {
    out.length = 0;
    runApplies(io(), { digitalElements: true, ai: true, ui: true });
    for (const a of KNOWN_ABSENT) expect(said()).toContain(a.instrument);
    // Absence must not read as a negative finding.
    expect(said()).toContain('is not a finding that the regulation does not apply');
  });

  it('refuses to guess when the product is not described', () => {
    err.length = 0;
    expect(runApplies(io(), {})).toBe(1);
    expect(err.join('\n')).toContain('Nothing is assumed');
  });
});
