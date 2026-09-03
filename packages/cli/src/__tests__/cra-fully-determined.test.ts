import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craAssess, craClassify } from '../cra/commands.js';
import { annexIRequirements } from '../cra/assess.js';

/**
 * The states only reachable once a person has actually done the work: an Annex
 * I assessment with nothing left undetermined, and the three verdicts of the
 * scope test.
 *
 * The exit codes here are what a CI pipeline gates on, and the fully-determined
 * case is the one nobody had ever produced, so the code path that says "you are
 * done" had never run.
 */
let dir: string;
const out: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: () => {} });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-fd-'));
  out.length = 0;
  craProduct(io(), { name: 'Acme Gateway', version: '2.4.0' });
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const determineAll = (status: 'met' | 'not_applicable' | 'not_met') => {
  for (const r of annexIRequirements()) {
    craAssess(io(), { ref: r.ref, status, by: 'Pedram Madani', rationale: 'reviewed in full' });
  }
  out.length = 0;
};

describe('an Annex I assessment with nothing left undetermined', () => {
  it('exits 0 when every requirement is met', () => {
    determineAll('met');
    expect(craAssess(io(), {})).toBe(0);
  });

  it('exits 0 in json mode too, so CI and a human agree', () => {
    determineAll('met');
    expect(craAssess(io(), { json: true })).toBe(0);
    expect(JSON.parse(out.join('\n')).counts.not_assessed).toBe(0);
  });

  it('exits 2 when everything is determined but something is NOT met', () => {
    determineAll('not_met');
    // 2, not 3: nothing is unknown, something is wrong. A pipeline should be
    // able to tell "unfinished" from "finished and failing".
    expect(craAssess(io(), {})).toBe(2);
    expect(craAssess(io(), { json: true })).toBe(2);
  });

  it('treats not_applicable as determined, not as a gap', () => {
    determineAll('not_applicable');
    expect(craAssess(io(), {})).toBe(0);
  });
});

describe('the three scope verdicts, and their exit codes', () => {
  it('in scope exits 0', () => {
    expect(craClassify(io(), { kind: 'software', connected: true, commercial: true, json: true })).toBe(0);
    expect(JSON.parse(out.join('\n')).verdict).toBe('in_scope');
  });

  it('a standalone service with the RDPS test unanswered is UNCERTAIN, exit 3', () => {
    expect(craClassify(io(), { kind: 'service_only', connected: true, commercial: true, json: true })).toBe(3);
    expect(JSON.parse(out.join('\n')).verdict).toBe('uncertain');
  });

  it('answering all three RDPS conditions resolves it', () => {
    const code = craClassify(io(), {
      kind: 'service_only', connected: true, commercial: true,
      rdpsDistance: true, rdpsManufacturer: true, rdpsFunction: true, json: true,
    });
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.verdict).not.toBe('uncertain');
    expect([0, 3]).toContain(code);
  });

  it('a displacing regime takes it out of scope', () => {
    const code = craClassify(io(), { kind: 'software', connected: true, commercial: true, excluded: 'medical', json: true });
    expect(JSON.parse(out.join('\n')).verdict).toBe('out_of_scope');
    expect(code).toBe(0);
  });
});
