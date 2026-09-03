import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildArticle14Report,
  dueFor,
  renderArticle14Markdown,
  reportEnvelope,
  SEVERITY_LIMBS,
  type ReportFacts,
} from '../cra/article14.js';

const FACTS: ReportFacts = {
  cve: 'CVE-2023-4863',
  product: { name: 'Acme Gateway', version: '2.4.0' },
  awareAt: '2026-09-14T09:00:00.000Z',
  inKev: true,
};

/**
 * THE GUARD THAT MATTERS MOST HERE.
 *
 * Every `requirement` string is meant to be Official Journal text. Typing legal
 * text from memory is how a tool ends up citing a duty that does not exist, and
 * this is the same failure that put an invented KEV description in a fixture
 * earlier and made a broken join look correct. So each one is checked against
 * the OJ excerpt actually stored in the repository.
 */
describe('every requirement is verbatim OJ text, not typed from memory', () => {
  const oj = readFileSync(join(process.cwd(), 'corpus', 'eu-cra', 'source', 'oj-excerpt.txt'), 'utf8');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const flat = norm(oj);

  const stages = ['early-warning', 'vulnerability', 'final'] as const;
  const all = [
    ...stages.flatMap((stage) => buildArticle14Report(stage, FACTS).fields),
    ...stages.flatMap((stage) => buildArticle14Report(stage, { ...FACTS, track: 'incident' }).fields),
    ...SEVERITY_LIMBS.map((l) => ({ ref: l.ref, requirement: l.text })),
  ];

  it.each(all.map((f) => [f.ref, f.requirement] as const))('%s is in the OJ excerpt', (_ref, requirement) => {
    expect(flat).toContain(norm(requirement));
  });

  it('covers all three stages', () => {
    expect(all.length).toBeGreaterThanOrEqual(11);
  });
});

describe('due dates', () => {
  it('runs 24h and 72h from awareness', () => {
    expect(dueFor('early-warning', FACTS).dueAt).toBe('2026-09-15T09:00:00.000Z');
    expect(dueFor('vulnerability', FACTS).dueAt).toBe('2026-09-17T09:00:00.000Z');
  });

  /**
   * The regression. Article 14(2)(c) says "no later than 14 days after a
   * corrective or mitigating measure IS AVAILABLE". Computing it from awareness
   * invents a deadline the Regulation does not impose: a fix taking thirty days
   * would read as overdue on day fourteen.
   */
  it('does NOT start the 14-day clock from awareness', () => {
    const { dueAt, rule } = dueFor('final', FACTS);
    expect(dueAt).toBeNull();
    expect(rule).toContain('No remedy is recorded');
    // And it must not read as relief from the other two.
    expect(rule).toContain('the 24h and 72h duties are unaffected');
  });

  it('starts the 14-day clock from the remedy when one exists', () => {
    const { dueAt } = dueFor('final', { ...FACTS, remedyAvailableAt: '2026-10-01T00:00:00.000Z' });
    expect(dueAt).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('the draft never invents content', () => {
  it('names Member States as a gap when none are recorded', () => {
    const r = buildArticle14Report('early-warning', FACTS);
    expect(r.gaps.some((g) => g.includes('Member States'))).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('fills Member States when they ARE recorded', () => {
    const r = buildArticle14Report('early-warning', { ...FACTS, memberStates: ['DE', 'FR'] });
    expect(r.gaps.some((g) => g.includes('Member States'))).toBe(false);
    expect(r.fields.find((f) => f.ref.includes('Member States'))?.content).toBe('DE, FR');
  });

  it('leaves the judgement fields to a person', () => {
    const r = buildArticle14Report('vulnerability', FACTS);
    for (const ref of ['measures taken', 'user measures', 'sensitivity']) {
      const f = r.fields.find((x) => x.ref.includes(ref))!;
      expect(f.content, `${ref} must not be generated`).toBeNull();
      expect(f.humanOnly).toBe(true);
    }
  });

  it('does not pass the catalogue description off as an exposure assessment', () => {
    const r = buildArticle14Report('vulnerability', { ...FACTS, exploitationNote: 'heap overflow in WebP' });
    const nature = r.fields.find((f) => f.ref.includes('nature'))!;
    expect(nature.content).toContain('NOT an assessment of this product');
  });

  it('does not invent actor attribution from a KEV listing', () => {
    const r = buildArticle14Report('final', FACTS);
    const actor = r.fields.find((f) => f.ref.includes('(ii)'))!;
    expect(actor.content).toContain('does not attribute an actor');
  });
});

describe('it can never read as a submission', () => {
  it('says so in the report, the markdown and the envelope', () => {
    const r = buildArticle14Report('early-warning', FACTS);
    expect(r.notice).toContain('THIS IS NOT A SUBMISSION');
    expect(renderArticle14Markdown(r)).toContain('THIS IS NOT A SUBMISSION');
    const env = reportEnvelope(r);
    expect(env.submitted).toBe(false);
    expect(String(env.notice)).toContain('NOT A SUBMISSION');
  });

  it('puts filing on the manufacturer, via the Article 16 platform', () => {
    const r = buildArticle14Report('final', FACTS);
    expect(r.notice).toContain('single reporting platform established under Article 16');
    expect(r.notice).toContain("manufacturer's act");
  });

  it('cites the duty each track actually sits under', () => {
    // 14(1) for a vulnerability, 14(3) for a severe incident. Citing the wrong
    // paragraph on a filing is small and still wrong.
    expect(buildArticle14Report('final', FACTS).notice).toContain('Article 14(1) obliges');
    expect(buildArticle14Report('final', { ...FACTS, track: 'incident' }).notice).toContain('Article 14(3) obliges');
  });
});

describe('the envelope is honest about being provisional', () => {
  it('says the field names are ours and will need mapping', () => {
    const env = reportEnvelope(buildArticle14Report('final', FACTS));
    expect(String(env.note)).toContain('not published');
    expect(String(env.note)).toContain('article references are the stable part');
  });

  it('marks each field drafted or gap, never silently empty', () => {
    const env = reportEnvelope(buildArticle14Report('vulnerability', FACTS));
    const fields = env.fields as { status: string; value: unknown }[];
    for (const f of fields) {
      expect(['drafted', 'gap']).toContain(f.status);
      if (f.status === 'gap') expect(f.value).toBeNull();
    }
  });
});

const INCIDENT: ReportFacts = { ...FACTS, track: 'incident' };

describe('the severe incident track is NOT the vulnerability track', () => {
  /**
   * Both open with 24h and 72h, which invites building the second by analogy.
   * The final reports are anchored to completely different events:
   *   14(2)(c) 14 days after a corrective measure is available
   *   14(4)(c) one month after the 14(4)(b) notification was submitted
   */
  it('anchors the final report to the notification, not to a remedy', () => {
    const withRemedy = dueFor('final', { ...INCIDENT, remedyAvailableAt: '2026-10-01T00:00:00.000Z' });
    expect(withRemedy.dueAt, 'a remedy must not start the incident clock').toBeNull();

    const submitted = dueFor('final', { ...INCIDENT, incidentNotificationSubmittedAt: '2026-09-17T09:00:00.000Z' });
    expect(submitted.dueAt).toBe('2026-10-17T09:00:00.000Z');
    expect(submitted.rule).toContain('one month');
  });

  it('says the clock has not started when the notification is unsubmitted', () => {
    const { dueAt, rule } = dueFor('final', INCIDENT);
    expect(dueAt).toBeNull();
    expect(rule).toContain('not recorded as submitted');
    expect(rule).toContain('24h and 72h duties are unaffected');
  });

  it('cites 14(4) rather than 14(2)', () => {
    expect(buildArticle14Report('early-warning', INCIDENT).article).toBe('Article 14(4)(a)');
    expect(buildArticle14Report('final', INCIDENT).article).toBe('Article 14(4)(c)');
    expect(buildArticle14Report('final', FACTS).article).toBe('Article 14(2)(c)');
  });

  it('calls the 72h filing an INCIDENT notification, as the OJ does', () => {
    expect(renderArticle14Markdown(buildArticle14Report('vulnerability', INCIDENT))).toContain('# Incident notification');
    expect(renderArticle14Markdown(buildArticle14Report('vulnerability', FACTS))).toContain('# Vulnerability notification');
  });

  it('requires the unlawful-or-malicious statement, which 14(2) has no counterpart for', () => {
    const r = buildArticle14Report('early-warning', INCIDENT);
    const f = r.fields.find((x) => x.ref.includes('unlawful or malicious'))!;
    expect(f).toBeDefined();
    expect(f.content).toBeNull();
    expect(buildArticle14Report('early-warning', FACTS).fields.some((x) => x.ref.includes('unlawful'))).toBe(false);
  });

  it('records the answer either way, since "not suspected" is also an answer', () => {
    const yes = buildArticle14Report('early-warning', { ...INCIDENT, suspectedUnlawfulOrMalicious: true });
    const no = buildArticle14Report('early-warning', { ...INCIDENT, suspectedUnlawfulOrMalicious: false });
    expect(yes.fields.find((f) => f.ref.includes('unlawful'))!.content).toContain('Suspected of being caused');
    expect(no.fields.find((f) => f.ref.includes('unlawful'))!.content).toContain('Not suspected');
  });

  it('asks for root cause, which the vulnerability final report does not', () => {
    const inc = buildArticle14Report('final', INCIDENT);
    expect(inc.fields.some((f) => f.requirement.includes('root cause'))).toBe(true);
    const vuln = buildArticle14Report('final', FACTS);
    expect(vuln.fields.some((f) => f.requirement.includes('root cause'))).toBe(false);
  });
});

describe('Article 14(5), the severity gate', () => {
  it('keeps both limbs verbatim, including "or is capable of"', () => {
    expect(SEVERITY_LIMBS).toHaveLength(2);
    for (const limb of SEVERITY_LIMBS) expect(limb.text).toMatch(/capable of/);
  });

  it('is a disjunction: either limb makes an incident severe', () => {
    expect(SEVERITY_LIMBS.map((l) => l.ref)).toEqual(['Article 14(5)(a)', 'Article 14(5)(b)']);
  });
});
