import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craSupport, craRecord } from '../cra/commands.js';

/**
 * Article 13(8) is a core obligation and it was missing from the record.
 *
 * The support period can be recorded two ways. `cra product --support-until`
 * puts a date on the product row. `cra support` writes to its own stream with
 * the declarant and the rationale that Article 13(8) requires and Annex VII (4)
 * asks for in the technical file. The record read only the product row, so a
 * manufacturer who used `cra support` produced a record with no support period
 * in it at all, and a `recordHash` that did not move.
 *
 * `cra doc` had already been fixed for exactly this, with a comment calling it
 * "the worst kind of gap: one the tool created itself". The record kept the bug.
 * It is the worse place to keep it, because a document can be regenerated and
 * the record is what gets signed.
 *
 * This is the same shape as the Annex I determinations being left out of the
 * hash: a stream that is written and never read back by the record.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  now: () => new Date('2026-08-15T12:00:00Z'),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-support-'));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the record covers the Article 13(8) support period', () => {
  it('is null when nobody has determined one, which is a live obligation', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    expect(craRecord(io(), {}).record!.supportPeriod).toBeNull();
  });

  it('carries the period recorded through `cra support`, with its rationale', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    craSupport(io(), {
      until: '2031-08-15',
      by: 'Pedram Madani',
      rationale: 'Five years, the Article 13(8) minimum.',
    });

    const sp = craRecord(io(), {}).record!.supportPeriod!;
    expect(sp.until).toBe('2031-08-15');
    expect(sp.declaredBy).toBe('Pedram Madani');
    expect(sp.declaredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(sp.rationale).toContain('Article 13(8)');
  });

  it('CHANGES recordHash when the period is recorded', () => {
    // The regression, stated directly: recording it used to leave the hash
    // byte-identical, so a signature covered a record with no support period.
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    const before = craRecord(io(), {}).record!.recordHash;

    craSupport(io(), { until: '2031-08-15', by: 'Pedram Madani', rationale: 'Five years.' });

    const after = craRecord(io(), {}).record!.recordHash;
    expect(
      after,
      'recording the support period did not change the record hash, so a signature would not cover it',
    ).not.toBe(before);
  });

  it('still sees a period set the other way, on the product row', () => {
    // `cra product --support-until` records a date and no reasoning. The record
    // must not miss it just because the richer command was not used.
    craProduct(io(), { name: 'Widget', version: '1.0.0', supportUntil: '2032-01-01' });

    const sp = craRecord(io(), {}).record!.supportPeriod!;
    expect(sp.until).toBe('2032-01-01');
    expect(sp.rationale).toBeUndefined();
  });

  it('reflects a superseding determination, not the first one recorded', () => {
    // The real case: a placeholder rationale recorded first, then replaced.
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    craSupport(io(), { until: '2031-08-15', by: 'Pedram Madani', rationale: '...' });
    craSupport(io(), {
      until: '2031-08-15',
      by: 'Pedram Madani',
      rationale: 'Five years from placing on the market, the Article 13(8) minimum.',
    });

    const sp = craRecord(io(), {}).record!.supportPeriod!;
    expect(sp.rationale).not.toBe('...');
    expect(sp.rationale).toContain('minimum');
  });
});
