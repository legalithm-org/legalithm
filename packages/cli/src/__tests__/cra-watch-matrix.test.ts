import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, craRecord, craAdvise } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * `cra watch` is the densest conditional in the package: KEV or fetched KEV,
 * OSV or not, EPSS from a file or fetched or absent, reachability on or off, a
 * product filter or none, JSON or prose. The suite drove one route through it.
 *
 * Each of those switches changes what lands in the record, so the untaken side
 * of each is a shape of evidence nobody had ever produced.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });
const text = () => `${out.join('\n')}\n${err.join('\n')}`;

const SBOM = { bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }, { name: 'lodash', version: '4.17.20' }] };
const OSV = [
  { id: 'G1', aliases: ['CVE-2023-4863'], summary: 'heap overflow', affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }] },
  { id: 'G2', aliases: ['CVE-2021-23337'], affected: [{ package: { name: 'lodash' }, versions: ['4.17.20'] }] },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-wm-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Acme Gateway', version: '2.4.0' });
  writeFileSync(join(dir, 's.json'), JSON.stringify(SBOM));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2023-4863', product: 'Chromium WebP', vulnerabilityName: 'x' }] }));
  writeFileSync(join(dir, 'kev-empty.json'), JSON.stringify({ vulnerabilities: [] }));
  writeFileSync(join(dir, 'epss.csv'), 'cve,epss,percentile\nCVE-2023-4863,0.94,0.99\nCVE-2021-23337,0.005,0.2\n');
  craIngest(io(), { sbom: join(dir, 's.json') });
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = () => ({ kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json') , becameAwareNow: true });

describe('the EPSS switch', () => {
  it('ranks with EPSS when supplied', async () => {
    await craWatch(io(), { ...base(), epss: join(dir, 'epss.csv'), becameAwareNow: true });
    expect(text()).toContain('EPSS');
    // The exploited one ranks first regardless of score.
    const lines = out.filter((l) => l.includes('CVE-'));
    expect(lines[0]).toContain('CVE-2023-4863');
  });

  it('works with no EPSS at all', async () => {
    await craWatch(io(), base());
    expect(text()).not.toContain('EPSS');
  });

  it('reports a broken EPSS file rather than silently ranking without it', async () => {
    expect(await craWatch(io(), { ...base(), epss: join(dir, 'absent.csv'), becameAwareNow: true })).toBe(1);
    expect(text()).toContain('Could not load EPSS');
  });
});

describe('the OSV switch', () => {
  it('reports an unreadable OSV dump', async () => {
    expect(await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'nope.json'), becameAwareNow: true })).toBe(1);
    expect(text()).toContain('Could not read the OSV dump');
  });

  it('finds nothing when the dump has nothing matching', async () => {
    writeFileSync(join(dir, 'osv-empty.json'), '[]');
    expect(await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv-empty.json'), becameAwareNow: true })).toBe(0);
    expect(text()).toContain('NOT "not affected"');
  });
});

describe('the KEV switch', () => {
  it('reports an unreadable KEV file and says how to run offline', async () => {
    expect(await craWatch(io(), { kev: join(dir, 'absent.json'), osv: join(dir, 'osv.json'), becameAwareNow: true })).toBe(1);
    expect(text()).toContain('--kev <path>');
  });

  it('starts no clock when nothing is exploited, and says why', async () => {
    await craWatch(io(), { kev: join(dir, 'kev-empty.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });
    expect(readStream(dir, 'clocks')).toHaveLength(0);
    expect(text()).toContain('different duty');
  });

  it('starts clocks only for the exploited subset', async () => {
    await craWatch(io(), base());
    const cves = new Set(readStream<{ cve: string }>(dir, 'clocks').map((c) => c.body.cve));
    expect(cves).toEqual(new Set(['CVE-2023-4863']));
  });
});

describe('the product filter', () => {
  it('accepts a name and finds the findings', async () => {
    await craWatch(io(), { ...base(), product: 'Acme Gateway', becameAwareNow: true });
    expect(text()).toContain('CVE-2023-4863');
  });

  it('refuses an unknown product name and lists what is registered', async () => {
    expect(await craWatch(io(), { ...base(), product: 'Not A Product', becameAwareNow: true })).toBe(1);
    expect(text()).toContain('Registered:');
  });
});

describe('what the record does with the result', () => {
  it('carries the machine verdict as a hypothesis, unsigned', async () => {
    await craWatch(io(), base());
    const h = readStream<{ requiresHumanSignOff: boolean; cve: string }>(dir, 'hypotheses');
    expect(h.length).toBeGreaterThan(0);
    expect(h[0]!.body.requiresHumanSignOff).toBe(true);
    expect(readStream(dir, 'claims')).toHaveLength(0);
  });

  it('surfaces both clocks and the user duty in one record', async () => {
    await craWatch(io(), base());
    craAdvise(io(), { cve: 'CVE-2023-4863' });
    out.length = 0;
    const r = craRecord(io(), {});
    expect(r.code).toBe(0);
    expect(out.join('\n')).toContain('users not informed 1');
    expect(out.join('\n')).toContain('open clocks 3');
  });

  it('re-running watch does not duplicate hypotheses', async () => {
    await craWatch(io(), base());
    const first = readStream(dir, 'hypotheses').length;
    await craWatch(io(), base());
    expect(readStream(dir, 'hypotheses')).toHaveLength(first);
  });
});
