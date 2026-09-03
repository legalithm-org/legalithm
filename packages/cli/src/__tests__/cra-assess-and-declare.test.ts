import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craAssess, craSupport } from '../cra/commands.js';
import { readStream } from '../cra/store.js';
import { annexIRequirements } from '../cra/assess.js';

/**
 * Recording determinations and declarations: the paths that WRITE a human's
 * assertion into the record.
 *
 * Everything else in the suite reads the record or refuses to write to it. This
 * covers the two commands that put a person's name against something, which is
 * the act the whole architecture is built to make accountable and which was
 * only ever tested by its refusal.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });
const text = () => `${out.join('\n')}\n${err.join('\n')}`;
const REF = annexIRequirements()[0]!.ref;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-as-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Acme Gateway', version: '2.4.0' });
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ingest --declare records an attributed assertion', () => {
  it('writes it with the signer as the source identity', () => {
    expect(craIngest(io(), { declare: 'No third-party components ship in this build.', by: 'Pedram Madani' })).toBe(0);
    const [e] = readStream<{ sourceType: string; sourceIdentity: string; confidence: string }>(dir, 'evidence');
    expect(e!.body.sourceType).toBe('attestation');
    expect(e!.body.sourceIdentity).toBe('Pedram Madani');
    // Asserted, not measured: a declaration is weaker evidence than a build.
    expect(e!.body.confidence).toBe('asserted');
  });

  it('is idempotent for the identical declaration', () => {
    const o = { declare: 'same words', by: 'Pedram Madani' };
    craIngest(io(), o);
    craIngest(io(), o);
    expect(readStream(dir, 'evidence')).toHaveLength(1);
  });
});

describe('assess records an Annex I determination', () => {
  it('refuses a status it does not recognise', () => {
    expect(craAssess(io(), { ref: REF, status: 'probably', by: 'Pedram Madani' })).toBe(1);
  });

  it('refuses a determination with no name behind it', () => {
    expect(craAssess(io(), { ref: REF, status: 'met' })).toBe(1);
  });

  it('refuses a reference that is not an Annex I requirement', () => {
    expect(craAssess(io(), { ref: 'Annex XIV (99)', status: 'met', by: 'Pedram Madani' })).toBe(1);
  });

  it('records met and moves the count off not_assessed', () => {
    expect(craAssess(io(), { ref: REF, status: 'met', by: 'Pedram Madani', rationale: 'reviewed the build' })).toBe(0);
    out.length = 0;
    craAssess(io(), {});
    expect(text()).toMatch(/met\s+1/);
  });

  it('records not_applicable, which is a determination and not a gap', () => {
    craAssess(io(), { ref: REF, status: 'not_applicable', by: 'Pedram Madani', rationale: 'no network interface' });
    out.length = 0;
    craAssess(io(), {});
    expect(text()).toMatch(/not applicable\s+1/);
  });

  it('records not_met, which must not read as done', () => {
    craAssess(io(), { ref: REF, status: 'not_met', by: 'Pedram Madani', rationale: 'no update mechanism yet' });
    out.length = 0;
    expect(craAssess(io(), {})).toBe(3);
  });

  it('filters the report to one Part', () => {
    craAssess(io(), { part: 'II' });
    expect(text()).toMatch(/Part II/);
  });

  it('refuses `met` with no rationale, the status that discharges the duty', () => {
    // Same principle as VEX not_affected: the discharging answer needs a reason.
    expect(craAssess(io(), { ref: REF, status: 'met', by: 'Pedram Madani' })).toBe(1);
  });

  it('json carries the per-requirement rows', () => {
    craAssess(io(), { ref: REF, status: 'met', by: 'Pedram Madani', rationale: 'reviewed' });
    out.length = 0;
    craAssess(io(), { json: true });
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.requirements.find((r: { ref: string }) => r.ref === REF).status).toBe('met');
  });

  it('a later determination supersedes the earlier one', () => {
    craAssess(io(), { ref: REF, status: 'met', by: 'Pedram Madani', rationale: 'reviewed' });
    craAssess(io(), { ref: REF, status: 'not_met', by: 'Pedram Madani', rationale: 'found a gap on review' });
    out.length = 0;
    craAssess(io(), { json: true });
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.requirements.find((r: { ref: string }) => r.ref === REF).status).toBe('not_met');
  });
});

describe('support period verdicts across the range', () => {
  const record = (until: string, placedOn: string, extra: Record<string, unknown> = {}) =>
    craSupport(io(), { until, placedOn, by: 'Pedram Madani', rationale: 'stated life', ...extra });

  it('warns when expiry is close on a period that clears the five-year floor', () => {
    // The span must exceed five years, or below_floor_justified is returned
    // first: that ordering is deliberate, since being under the floor is the
    // more serious fact than being near the end.
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect(record(soon, '2015-01-01')).toBe(3);
    expect(text()).toMatch(/ends in/i);
  });

  it('reports an expired period as a problem', () => {
    expect(record('2026-02-01', '2015-01-01')).toBe(2);
    expect(text()).toMatch(/expired|ended/i);
  });
});
