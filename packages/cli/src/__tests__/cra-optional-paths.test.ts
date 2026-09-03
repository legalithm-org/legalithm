import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  craProduct, craIngest, craWatch, craClaim, craAssess,
  craDoc, craSupport, craReport, craAdvise, craRecord,
} from '../cra/commands.js';
import { parseEpssCsv, parseOsvDump, matchOsv, prioritise } from '../cra/intel.js';
import { buildArticle14Report, renderArticle14Markdown } from '../cra/article14.js';

/**
 * The OTHER side of every optional flag.
 *
 * Most of these commands are built from `opts.x ? a : b`, and the suite only
 * ever exercised one branch of each. That matters more here than the number
 * suggests: the untaken branch is usually the one that formats a record, emits
 * JSON for a machine, or decides what to write into a technical file, and a
 * compliance artifact that is only ever produced one way has its other shape
 * untested.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });
const text = () => out.join('\n');

const SBOM = { bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }, { name: 'lodash', version: '4.17.20' }] };
const OSV = [
  { id: 'G1', aliases: ['CVE-2023-4863'], summary: 'heap overflow', affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }] },
  { id: 'G2', aliases: ['CVE-2021-23337'], affected: [{ package: { name: 'lodash' }, versions: ['4.17.20'] }] },
];
const KEV = { vulnerabilities: [{ cveID: 'CVE-2023-4863', vendorProject: 'Google', product: 'Chromium WebP', vulnerabilityName: 'heap overflow' }] };

const seed = async (extra: Record<string, unknown> = {}) => {
  craProduct(io(), { name: 'Acme Gateway', version: '2.4.0', ...extra });
  writeFileSync(join(dir, 's.json'), JSON.stringify(SBOM));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify(KEV));
  craIngest(io(), { sbom: join(dir, 's.json') });
  await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });
  out.length = 0;
  err.length = 0;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-opt-'));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('every command has a JSON shape as well as a human one', () => {
  it('product --json', () => {
    craProduct(io(), { name: 'p', version: '1', json: true });
    expect(JSON.parse(text())).toHaveProperty('product');
  });

  it('ingest --json', () => {
    craProduct(io(), { name: 'p', version: '1' });
    writeFileSync(join(dir, 's.json'), JSON.stringify(SBOM));
    out.length = 0;
    craIngest(io(), { sbom: join(dir, 's.json'), json: true });
    // The key is `created`, not `new`: the human output says "new", the
    // machine output says "created". Worth pinning so they cannot drift apart.
    expect(JSON.parse(text())).toHaveProperty('created');
  });

  it('watch --json carries the findings and the verdict field', async () => {
    await seed();
    await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), json: true, becameAwareNow: true });
    const parsed = JSON.parse(text());
    expect(parsed).toHaveProperty('hits');
    expect(parsed.hits[0]).toHaveProperty('verdict');
  });

  it('assess --json reports the counts', async () => {
    await seed();
    craAssess(io(), { json: true });
    expect(JSON.parse(text())).toHaveProperty('counts');
  });

  it('support --json reports the verdict', async () => {
    await seed();
    craSupport(io(), { json: true });
    expect(JSON.parse(text())).toHaveProperty('verdict');
  });

  it('doc --json returns the sections and their gaps', async () => {
    await seed();
    craDoc(io(), { type: 'technical-file', json: true });
    const parsed = JSON.parse(text());
    expect(parsed).toHaveProperty('gaps');
  });

  it('report --json marks itself unsubmitted', async () => {
    await seed();
    craReport(io(), { cve: 'CVE-2023-4863', stage: 'early-warning', json: true });
    expect(JSON.parse(text()).submitted).toBe(false);
  });

  it('advise --json marks itself unpublished', async () => {
    await seed();
    craAdvise(io(), { cve: 'CVE-2023-4863', json: true });
    expect(JSON.parse(text()).published).toBe(false);
  });
});

describe('the optional inputs that change what gets written', () => {
  it('support with a full justification records ok rather than a gap', async () => {
    await seed();
    expect(
      craSupport(io(), {
        until: '2032-01-01', placedOn: '2026-01-01',
        by: 'Pedram Madani', rationale: 'expected deployment life of the gateway',
      }),
    ).toBe(0);
  });

  it('support below the floor without justification is a problem, with it is not', async () => {
    await seed();
    const opts = { until: '2028-01-01', placedOn: '2026-01-01', by: 'Pedram Madani', rationale: 'short-lived promo unit' };
    expect(craSupport(io(), opts)).toBe(2);
    out.length = 0;
    expect(craSupport(io(), { ...opts, expectedUseShorter: true })).toBe(0);
  });

  it('claim with a rationale writes a claim and reports the source hypothesis', async () => {
    await seed();
    expect(craClaim(io(), {
      cve: 'CVE-2023-4863', verdict: 'not_affected', by: 'Pedram Madani',
      rationale: 'decoder path unreachable from any entry point',
    })).toBe(0);
    expect(text()).toContain('from         hypothesis');
  });

  it('claim --json returns the claim id', async () => {
    await seed();
    craClaim(io(), { cve: 'CVE-2023-4863', verdict: 'affected', by: 'Pedram Madani', json: true });
    expect(JSON.parse(text())).toHaveProperty('claim');
  });

  it('record --asOf answers as the record stood on a past date', async () => {
    await seed();
    const past = craRecord(io(), { asOf: '2020-01-01T00:00:00.000Z' });
    expect(past.code).toBe(1); // nothing was known then
  });

  it('doc writes to an explicit --out directory', async () => {
    await seed();
    craDoc(io(), { type: 'declaration', out: join(dir, 'docs', 'dec.md') });
    expect(readFileSync(join(dir, 'docs', 'dec.md'), 'utf8')).toContain('Annex V');
  });
});

describe('intel: the branches a single happy path never reaches', () => {
  it('skips the EPSS comment and header rows', () => {
    const m = parseEpssCsv('#model_version:2026\ncve,epss,percentile\nCVE-1,0.5,0.9\n\nbad-line\n');
    expect(m.get('CVE-1')).toEqual({ epss: 0.5, percentile: 0.9 });
    expect(m.size).toBe(1);
  });

  it('defaults a missing percentile rather than storing NaN', () => {
    expect(parseEpssCsv('CVE-2,0.4,notanumber\n').get('CVE-2')).toEqual({ epss: 0.4, percentile: 0 });
  });

  it('drops a row with an unparseable score', () => {
    expect(parseEpssCsv('CVE-3,nope,0.1\n').size).toBe(0);
  });

  it('reads all three OSV shapes: array, {vulns}, and NDJSON', () => {
    expect(parseOsvDump('[{"id":"a"}]')).toHaveLength(1);
    expect(parseOsvDump('{"vulns":[{"id":"a"},{"id":"b"}]}')).toHaveLength(2);
    expect(parseOsvDump('{"id":"a"}\n{"id":"b"}\n')).toHaveLength(2);
    expect(parseOsvDump('   ')).toEqual([]);
  });

  it('reports name_only when a record lists no versions', () => {
    const m = matchOsv([{ component: 'lodash', version: '4.17.20' }], [
      { id: 'X', affected: [{ package: { name: 'lodash' } }] },
    ]);
    expect(m[0]!.confidence).toBe('name_only');
    expect(m[0]!.cve).toBeNull();
  });

  it('ranks KEV above any EPSS score', () => {
    const ranked = prioritise(
      [{ cve: 'CVE-LOW' }, { cve: 'CVE-KEV' }],
      new Set(['CVE-KEV']),
      new Map([['CVE-LOW', { epss: 0.99, percentile: 1 }]]),
    );
    expect(ranked[0]!.cve).toBe('CVE-KEV');
    expect(ranked[0]!.inKev).toBe(true);
  });
});

describe('article 14 rendering, both tracks', () => {
  const facts = { cve: 'CVE-1', awareAt: '2026-09-14T00:00:00.000Z', inKev: true };

  it('renders a document with no product recorded', () => {
    const md = renderArticle14Markdown(buildArticle14Report('early-warning', facts));
    expect(md).toContain('GAP');
    expect(md).not.toContain('Product:');
  });

  it('renders the incident track final report with a started clock', () => {
    const md = renderArticle14Markdown(
      buildArticle14Report('final', { ...facts, track: 'incident', incidentNotificationSubmittedAt: '2026-09-20T00:00:00.000Z' }),
    );
    expect(md).toContain('# Final report');
    expect(md).toContain('one month');
  });
});
