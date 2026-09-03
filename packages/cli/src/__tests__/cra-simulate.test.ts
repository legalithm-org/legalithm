import { describe, it, expect } from 'vitest';

import { craSimulate } from '../cra/simulate.js';
import { CRA_EVENTS, dueAtFor, informationState } from '../cra/reporting-events.js';

/**
 * The simulator runs the real clock arithmetic on a hypothetical.
 *
 * The properties that matter are that it writes nothing, that it holds the same awareness
 * invariant as the real command, and that the two final reports are NOT treated as the
 * same clock — 14(2)(c) waits on a remedy existing, 14(4)(c) on the 72-hour notification
 * having been filed. A copy-paste of one table into the other is the plausible mistake.
 */
const NOW = new Date('2026-09-15T18:00:00.000Z');
const AWARE = '2026-09-15T10:15:00.000Z';
const run = (opts: Parameters<typeof craSimulate>[1]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = craSimulate({ log: (m) => out.push(m), error: (m) => err.push(m), now: () => NOW }, opts);
  return { code, out: out.join('\n'), err: err.join('\n') };
};

describe('cra simulate', () => {
  it('holds the awareness invariant, exactly as the real command does', () => {
    const r = run({ scenario: 'exploited-vulnerability' });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/became-aware/);
  });

  it('computes the 24h and 72h deadlines from awareness', () => {
    const r = run({ scenario: 'exploited-vulnerability', becameAwareAt: AWARE });
    expect(r.code).toBe(0);
    expect(r.out).toContain('2026-09-16 10:15:00 UTC'); // 24h
    expect(r.out).toContain('2026-09-18 10:15:00 UTC'); // 72h
  });

  it('says plainly that it wrote nothing and does not notify', () => {
    // The copy is the claim. Legalithm does not notify, so the demo must not imply it.
    const r = run({ scenario: 'exploited-vulnerability', becameAwareNow: true });
    expect(r.out).toMatch(/SIMULATION/);
    expect(r.out).toMatch(/nothing was written/i);
    expect(r.out).toMatch(/does NOT notify/);
    expect(r.out).toMatch(/single reporting platform/i);
  });

  it('the two final reports are different clocks, not a copy of each other', () => {
    const vuln = CRA_EVENTS['exploited-vulnerability'].deliverables.find((d) => d.article === '14(2)(c)')!;
    const incident = CRA_EVENTS['severe-incident'].deliverables.find((d) => d.article === '14(4)(c)')!;

    // Neither is computable from awareness...
    expect(dueAtFor(vuln, new Date(AWARE))).toBeNull();
    expect(dueAtFor(incident, new Date(AWARE))).toBeNull();

    // ...but for different reasons, and the text must say which.
    expect(vuln.notFromAwareness).toMatch(/AVAILABLE/);
    expect(incident.notFromAwareness).toMatch(/SUBMISSION/);
    expect(vuln.notFromAwareness).not.toBe(incident.notFromAwareness);
  });

  it('a severe incident reports under 14(3)/(4), not 14(1)/(2)', () => {
    const r = run({ scenario: 'severe-incident', becameAwareAt: AWARE });
    expect(r.out).toContain('Article 14(3)');
    expect(r.out).toContain('Article 14(4)');
    expect(r.out).toContain('14(4)(a)');
    expect(r.out).not.toContain('14(2)(a)');
  });

  it('splits required information into known and missing, from the article text', () => {
    const early = CRA_EVENTS['severe-incident'].deliverables.find((d) => d.article === '14(4)(a)')!;
    const { known, missing } = informationState(early, [
      'Whether the incident is suspected of being caused by unlawful or malicious acts',
    ]);
    expect(known).toHaveLength(1);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Member States/);
  });

  it('refuses an unknown scenario rather than guessing which duty applies', () => {
    const r = run({ scenario: 'data-breach', becameAwareNow: true });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/exploited-vulnerability/);
    expect(r.err).toMatch(/severe-incident/);
  });

  it('shows overdue rather than a negative countdown', () => {
    const r = run({ scenario: 'exploited-vulnerability', becameAwareAt: '2026-09-13T10:15:00.000Z' });
    expect(r.out).toMatch(/OVERDUE/);
  });
});
