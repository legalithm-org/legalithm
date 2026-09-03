import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craAssess, craRecord } from '../cra/commands.js';

/**
 * The record has to cover the determinations, or signing it proves nothing about
 * the part with legal weight.
 *
 * `cra assess` wrote Annex I determinations to the assessments stream, and
 * `cra record` did not read that stream. The determinations were absent from
 * record.json and therefore outside `recordHash`, so `cra record --sign`
 * produced a signature over a document containing the component inventory and
 * the machine findings and none of the twenty-two statements a named human had
 * put their name to. Recording all 22 left the hash byte-identical, which is the
 * clearest possible symptom and went unnoticed because nothing compared it.
 *
 * A machine finding is a hypothesis and carries no weight until a person signs
 * it. The determinations ARE the signed part. Leaving them out of the hash
 * inverted which half of the record was protected.
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
  dir = mkdtempSync(join(tmpdir(), 'cra-annexi-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Widget', version: '1.0.0' });
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the record covers the Annex I determinations', () => {
  it('carries every determination, attributed and dated', () => {
    craAssess(io(), {
      ref: 'Annex I Part II (5)',
      status: 'not_met',
      by: 'Pedram Madani',
      rationale: 'A reporting address is a channel, not a policy.',
    });

    const { record } = craRecord(io(), {});
    expect(record).toBeDefined();
    expect(record!.annexI.determined).toHaveLength(1);

    const d = record!.annexI.determined[0]!;
    expect(d.ref).toBe('Annex I Part II (5)');
    expect(d.status).toBe('not_met');
    expect(d.declaredBy).toBe('Pedram Madani');
    expect(d.declaredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(d.rationale).toContain('not a policy');
  });

  it('CHANGES recordHash when a determination is recorded', () => {
    // The regression, stated directly: 22 determinations used to leave the hash
    // byte-identical.
    const before = craRecord(io(), {}).record!.recordHash;

    craAssess(io(), {
      ref: 'Annex I Part II (5)',
      status: 'not_met',
      by: 'Pedram Madani',
      rationale: 'A reporting address is a channel, not a policy.',
    });

    const after = craRecord(io(), {}).record!.recordHash;
    expect(
      after,
      'recording a determination did not change the record hash, so a signature would not cover it',
    ).not.toBe(before);
  });

  it('distinguishes a determination from a requirement nobody has looked at', () => {
    craAssess(io(), {
      ref: 'Annex I Part II (5)',
      status: 'not_met',
      by: 'Pedram Madani',
      rationale: 'A reporting address is a channel, not a policy.',
    });

    const { record } = craRecord(io(), {});
    // 22 requirements in Annex I, one determined.
    expect(record!.annexI.notAssessed).toHaveLength(21);
    expect(record!.annexI.notAssessed).not.toContain('Annex I Part II (5)');
    // Silence and "not assessed" must not read the same to an auditor.
    expect(record!.annexI.notAssessed).toContain('Annex I Part I (1)');
  });

  it('lists all 22 as not assessed before anyone has determined anything', () => {
    const { record } = craRecord(io(), {});
    expect(record!.annexI.determined).toEqual([]);
    expect(record!.annexI.notAssessed).toHaveLength(22);
  });

  it('reflects a superseding determination, not the first one recorded', () => {
    craAssess(io(), { ref: 'Annex I Part II (5)', status: 'not_met', by: 'Pedram Madani', rationale: 'No policy yet.' });
    craAssess(io(), { ref: 'Annex I Part II (5)', status: 'met', by: 'Pedram Madani', rationale: 'Policy published.' });

    const { record } = craRecord(io(), {});
    expect(record!.annexI.determined).toHaveLength(1);
    expect(record!.annexI.determined[0]!.status).toBe('met');
  });
});
