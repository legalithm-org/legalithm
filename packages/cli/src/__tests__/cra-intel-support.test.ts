import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseEpssCsv, parseOsvDump, matchOsv, prioritise } from '../cra/intel.js';
import { supportStatus, supportExitCode, yearsBetween } from '../cra/support.js';
import { craProduct, craSupport, type CraIo } from '../cra/commands.js';

let cwd: string;
let out: string[];
let err: string[];
let io: CraIo;
const NOW = new Date('2026-08-14T00:00:00Z');

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'is-'));
  out = [];
  err = [];
  io = { cwd, log: (m) => out.push(m), error: (m) => err.push(m), now: () => NOW };
});

describe('EPSS and OSV are joined locally (feature 4)', () => {
  /**
   * The privacy rule. A per-CVE or per-package lookup would send the
   * vulnerability list or the SBOM to a third party, and that list is a map of
   * how to attack the product. The convenient endpoint is one line away, so
   * this is asserted rather than trusted.
   */
  it('never queries a per-item endpoint', () => {
    const src = readFileSync('packages/cli/src/cra/intel.ts', 'utf8');
    expect(src).not.toMatch(/api\.first\.org[^\n]*\?cve=/);
    expect(src).not.toMatch(/api\.osv\.dev\/v1\/query/);
    expect(src).toContain('epss_scores-current.csv.gz');
  });

  it('parses the EPSS daily CSV, skipping the model comment and header', () => {
    const m = parseEpssCsv(
      '#model_version:v2025.03.14,score_date:2026-08-14T00:00:00+0000\ncve,epss,percentile\nCVE-2023-4863,0.94212,0.99912\n',
    );
    expect(m.size).toBe(1);
    expect(m.get('CVE-2023-4863')!.epss).toBeCloseTo(0.94212);
  });

  it('reads OSV as an array, an object, or newline-delimited JSON', () => {
    const rec = '{"id":"GHSA-1","affected":[{"package":{"name":"lodash"}}]}';
    expect(parseOsvDump(`[${rec}]`)).toHaveLength(1);
    expect(parseOsvDump(`{"vulns":[${rec}]}`)).toHaveLength(1);
    expect(parseOsvDump(`${rec}\n${rec}`)).toHaveLength(2);
  });

  /** A false negative here is a vulnerability you were told you did not have. */
  it('matches an exact version and rejects a different one', () => {
    const records = parseOsvDump(
      JSON.stringify([
        { id: 'GHSA-a', aliases: ['CVE-2021-23337'], affected: [{ package: { name: 'lodash' }, versions: ['4.17.20'] }] },
        { id: 'GHSA-b', aliases: ['CVE-2099-9999'], affected: [{ package: { name: 'lodash' }, versions: ['3.0.0'] }] },
      ]),
    );
    const m = matchOsv([{ component: 'lodash', version: '4.17.20' }], records);
    expect(m).toHaveLength(1);
    expect(m[0]!.cve).toBe('CVE-2021-23337');
    expect(m[0]!.confidence).toBe('exact');
  });

  it('flags a name-only match rather than reporting it as clean', () => {
    const records = parseOsvDump(JSON.stringify([{ id: 'GHSA-c', affected: [{ package: { name: 'zlib' } }] }]));
    const m = matchOsv([{ component: 'zlib', version: '1.3.1' }], records);
    expect(m[0]!.confidence).toBe('name_only');
  });

  /** KEV outranks any prediction; EPSS orders the rest and discharges nothing. */
  it('ranks KEV above EPSS', () => {
    const ranked = prioritise(
      [{ cve: 'CVE-LOW' }, { cve: 'CVE-KEV' }, { cve: 'CVE-HIGH' }],
      new Set(['CVE-KEV']),
      new Map([
        ['CVE-HIGH', { epss: 0.9, percentile: 0.99 }],
        ['CVE-LOW', { epss: 0.01, percentile: 0.2 }],
      ]),
    );
    expect(ranked.map((r) => r.cve)).toEqual(['CVE-KEV', 'CVE-HIGH', 'CVE-LOW']);
    expect(ranked[0]!.inKev).toBe(true);
  });
});

describe('support period register (feature 11)', () => {
  const base = { declaredBy: 'Pedram', rationale: 'industrial gateway, reasonable user expectation' };

  it('reports not_set when nothing is recorded', () => {
    const s = supportStatus(null, NOW);
    expect(s.verdict).toBe('not_set');
    expect(supportExitCode(s)).toBe(3);
  });

  /**
   * Article 13(8) is a floor WITH an exception: under five years is lawful
   * where the product is expected to be in use for less. Enforcing five years
   * flatly would be wrong, and is how this CLI first shipped it.
   */
  it('flags a short period as unjustified, and accepts it when justified', () => {
    const short = { ...base, until: '2029-01-01', placedOn: '2027-12-11' };
    const bad = supportStatus(short, NOW);
    expect(bad.verdict).toBe('below_floor_unjustified');
    expect(supportExitCode(bad)).toBe(2);

    const good = supportStatus({ ...short, expectedUseShorter: true }, NOW);
    expect(good.verdict).toBe('below_floor_justified');
    expect(supportExitCode(good)).toBe(0);
    expect(good.message).toContain('Annex VII (4)');
  });

  it('accepts five years or more', () => {
    const s = supportStatus({ ...base, until: '2033-01-01', placedOn: '2027-12-11' }, NOW);
    expect(s.verdict).toBe('ok');
    expect(s.years).toBeGreaterThan(5);
  });

  it('warns before expiry and reports after it', () => {
    expect(supportStatus({ ...base, until: '2026-10-01' }, NOW).verdict).toBe('expiring_soon');
    const expired = supportStatus({ ...base, until: '2026-01-01' }, NOW);
    expect(expired.verdict).toBe('expired');
    expect(expired.message).toContain('10-year documentation retention');
    expect(supportExitCode(expired)).toBe(2);
  });

  it('computes the span in years', () => {
    expect(yearsBetween('2027-12-11', '2032-12-11')).toBeCloseTo(5, 1);
  });

  /** A date without reasoning is an incomplete record under Annex VII (4). */
  it('refuses a date with no rationale', () => {
    craProduct(io, { name: 'x', version: '1' });
    expect(craSupport(io, { until: '2033-01-01', by: 'Pedram' })).toBe(1);
    expect(err.join('\n')).toContain('Annex VII (4)');
  });

  it('rejects a malformed date', () => {
    expect(craSupport(io, { until: 'next year', by: 'a', rationale: 'b' })).toBe(1);
  });

  it('supersedes when the end date changes', () => {
    craSupport(io, { until: '2033-01-01', by: 'a', rationale: 'r' });
    craSupport(io, { until: '2034-01-01', by: 'a', rationale: 'r2' });
    expect(craSupport(io, { json: true })).toBe(0);
    expect(out.join('\n')).toContain('2034-01-01');
  });
});
