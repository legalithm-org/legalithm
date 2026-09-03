import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classify } from '../cra/classify.js';
import { craClassify, type CraIo } from '../cra/commands.js';
import { readStream, asOf } from '../cra/store.js';

let cwd: string;
let out: string[];
let io: CraIo;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cls-'));
  out = [];
  io = { cwd, log: (m) => out.push(m), error: (m) => out.push(m) };
});

const CONNECTED = { hasDataConnection: true, commercialActivity: true, placedOnEuMarket: true } as const;

describe('CRA scope: the SaaS question', () => {
  /**
   * The finding that reframed the whole pack: standalone SaaS is out. Article
   * 3(1) reaches a service only as a remote data processing solution.
   */
  it('puts browser-only SaaS out of scope when the Article 3(2) legs are not all met', () => {
    const d = classify({
      kind: 'service_only',
      rdps: { processesAtDistance: true, byOrUnderManufacturer: true, absenceBreaksAFunction: false },
    });
    expect(d.verdict).toBe('out_of_scope');
    expect(d.steps.some((s) => s.basis === 'Article 3(2)')).toBe(true);
  });

  it('brings a service in when all three legs are met', () => {
    const d = classify({
      kind: 'service_only',
      ...CONNECTED,
      rdps: { processesAtDistance: true, byOrUnderManufacturer: true, absenceBreaksAFunction: true },
    });
    expect(d.verdict).toBe('in_scope');
    expect(d.steps.some((s) => s.basis === 'Article 3(1)')).toBe(true);
  });

  /** Refusing to answer is a feature. A confident wrong out_of_scope is the expensive error. */
  it('returns uncertain rather than guessing when the legs are unanswered', () => {
    const d = classify({ kind: 'service_only' });
    expect(d.verdict).toBe('uncertain');
    expect(d.reason).toContain('Article 3(2)');
  });
});

describe('CRA scope: displacing regimes and commercial activity', () => {
  it.each([
    ['medical', 'Article 2(2)(a)'],
    ['ivd', 'Article 2(2)(b)'],
    ['vehicle', 'Article 2(2)(c)'],
    ['aviation', 'Article 2(3)'],
    ['marine', 'Article 2(4)'],
    ['spare_part', 'Article 2(6)'],
    ['defence', 'Article 2(7)'],
  ] as const)('excludes %s under %s', (regime, basis) => {
    const d = classify({ kind: 'hardware', ...CONNECTED, excludedRegime: regime });
    expect(d.verdict).toBe('out_of_scope');
    expect(d.steps[0]!.basis).toBe(basis);
  });

  /** Free of charge is still commercial; only non-commercial supply is out. */
  it('excludes non-commercial supply under Article 3(22)', () => {
    const d = classify({ kind: 'software', hasDataConnection: true, commercialActivity: false });
    expect(d.verdict).toBe('out_of_scope');
    expect(d.steps[0]!.basis).toBe('Article 3(22)');
    expect(d.reason).toContain('free of charge is still commercial');
  });

  it('excludes a product with no data connection under Article 2(1)', () => {
    const d = classify({ kind: 'hardware', hasDataConnection: false, commercialActivity: true });
    expect(d.verdict).toBe('out_of_scope');
    expect(d.steps[0]!.basis).toBe('Article 2(1)');
  });
});

describe('CRA classification: role, class and route', () => {
  it('reassigns an importer who rebrands to manufacturer under Article 21', () => {
    const d = classify({ kind: 'hardware', ...CONNECTED, role: 'importer', rebrandsOrModifies: true });
    expect(d.effectiveRole).toBe('manufacturer');
    expect(d.steps.some((s) => s.basis === 'Article 21')).toBe(true);
  });

  it('leaves a plain distributor as a distributor', () => {
    const d = classify({ kind: 'hardware', ...CONNECTED, role: 'distributor' });
    expect(d.effectiveRole).toBe('distributor');
    expect(d.steps.some((s) => s.basis === 'Article 21')).toBe(false);
  });

  it.each([
    [{}, 'default', 'Article 32(1)'],
    [{ annexIii: 'class_i' as const }, 'important_class_i', 'Article 32(2)'],
    [{ annexIii: 'class_ii' as const }, 'important_class_ii', 'Article 32(3)'],
    [{ annexIv: true }, 'critical', 'Article 32(4)'],
  ])('routes %o to %s', (extra, cls, route) => {
    const d = classify({ kind: 'hardware', ...CONNECTED, ...extra });
    expect(d.productClass).toBe(cls);
    expect(d.conformityRoute).toContain(route);
  });

  it('says class I has no self-assessment route in practice today', () => {
    const d = classify({ kind: 'hardware', ...CONNECTED, annexIii: 'class_i' });
    expect(d.conformityRoute).toContain('None is cited in the Official Journal');
  });

  it('gives the two dates from Article 71(2)', () => {
    const d = classify({ kind: 'hardware', ...CONNECTED });
    expect(d.appliesFrom).toEqual({ reporting: '2026-09-11', general: '2027-12-11' });
    expect(d.steps.some((s) => s.basis === 'Article 71(2)')).toBe(true);
  });
});

describe('every answer is cited', () => {
  it('carries an article and a quote on every step', () => {
    const cases = [
      { kind: 'hardware' as const, ...CONNECTED },
      { kind: 'hardware' as const, ...CONNECTED, excludedRegime: 'medical' as const },
      { kind: 'service_only' as const },
      { kind: 'software' as const, hasDataConnection: true, commercialActivity: false },
    ];
    for (const c of cases) {
      for (const s of classify(c).steps) {
        expect(s.basis, `${s.id} has no basis`).toMatch(/^(Article|Annex)/);
        expect(s.quote.length, `${s.id} has no quote`).toBeGreaterThan(20);
      }
    }
  });
});

describe('cra classify is re-runnable and recorded', () => {
  it('stores the determination so it can be produced later', () => {
    craClassify(io, { kind: 'hardware', connected: true, commercial: true, euMarket: true });
    const rows = readStream(cwd, 'classification');
    expect(rows).toHaveLength(1);
  });

  /** A changed verdict supersedes; the earlier answer stays readable. */
  it('supersedes rather than overwrites when the verdict changes', () => {
    craClassify(io, { kind: 'hardware', connected: true, commercial: true, euMarket: true });
    craClassify(io, { kind: 'hardware', connected: true, commercial: true, excluded: 'medical' });
    expect(readStream(cwd, 'classification')).toHaveLength(2);
    const live = asOf(readStream(cwd, 'classification'));
    expect(live).toHaveLength(1);
  });

  it('exits 3 on uncertain so a pipeline can treat it as needing a human', () => {
    expect(craClassify(io, { kind: 'service_only' })).toBe(3);
  });

  it('refuses an unknown kind rather than guessing', () => {
    expect(craClassify(io, { kind: 'nonsense' })).toBe(1);
  });
});
