import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEpss, loadOsv, fetchEpss, EPSS_FULL_CSV, matchOsv } from '../cra/intel.js';

/**
 * How the datasets actually ARRIVE, which is the part that had never run.
 *
 * The real EPSS export is a .gz and the real OSV export is a large archive, so
 * the gzip and fetch paths are what execute in production while every test so
 * far handed the parser a plain string. A transport bug there does not produce
 * a wrong answer, it produces no answer, and `cra watch` would report an empty
 * ranking that reads like a clean result.
 */
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'intel-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CSV = 'cve,epss,percentile\nCVE-2023-4863,0.94,0.99\nCVE-2021-23337,0.005,0.2\n';

describe('EPSS arrives gzipped or plain', () => {
  it('reads a plain .csv', () => {
    const p = join(dir, 'e.csv');
    writeFileSync(p, CSV);
    expect(loadEpss(p).get('CVE-2023-4863')!.epss).toBe(0.94);
  });

  it('reads the .gz the real export actually is', () => {
    const p = join(dir, 'e.csv.gz');
    writeFileSync(p, gzipSync(Buffer.from(CSV)));
    const m = loadEpss(p);
    expect(m.size).toBe(2);
    expect(m.get('CVE-2021-23337')!.percentile).toBe(0.2);
  });

  it('uppercases the CVE key, so a lowercase lookup still hits', () => {
    const p = join(dir, 'e.csv');
    writeFileSync(p, 'cve,epss,percentile\ncve-2023-4863,0.1,0.2\n');
    expect(loadEpss(p).has('CVE-2023-4863')).toBe(true);
  });
});

describe('OSV arrives gzipped or plain', () => {
  const dump = JSON.stringify([{ id: 'G', aliases: ['CVE-1'], affected: [{ package: { name: 'lodash' }, versions: ['4.17.20'] }] }]);

  it('reads a plain .json', () => {
    const p = join(dir, 'o.json');
    writeFileSync(p, dump);
    expect(loadOsv(p)).toHaveLength(1);
  });

  it('reads a .gz', () => {
    const p = join(dir, 'o.json.gz');
    writeFileSync(p, gzipSync(Buffer.from(dump)));
    expect(loadOsv(p)).toHaveLength(1);
  });
});

describe('fetchEpss downloads the WHOLE dataset, never a per-CVE query', () => {
  it('requests the full export URL and gunzips it', async () => {
    let requested = '';
    const fakeFetch = (async (url: string) => {
      requested = String(url);
      return { ok: true, arrayBuffer: async () => gzipSync(Buffer.from(CSV)) };
    }) as unknown as typeof fetch;

    const m = await fetchEpss(fakeFetch);
    expect(requested).toBe(EPSS_FULL_CSV);
    // The privacy rule, asserted at the transport layer: one request for
    // everything, with no CVE of ours in the URL.
    expect(requested).not.toMatch(/CVE-/i);
    expect(m.size).toBe(2);
  });

  it('throws with the status rather than returning an empty ranking', async () => {
    const failing = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(fetchEpss(failing)).rejects.toThrow(/503/);
  });
});

describe('matchOsv version handling', () => {
  const rec = (versions?: string[]) => [
    { id: 'G', aliases: ['CVE-1'], affected: [{ package: { name: 'lodash' }, ...(versions ? { versions } : {}) }] },
  ];

  it('matches an exact listed version', () => {
    const m = matchOsv([{ component: 'lodash', version: '4.17.20' }], rec(['4.17.20']));
    expect(m[0]!.confidence).toBe('exact');
  });

  it('does NOT match a version the record does not list', () => {
    expect(matchOsv([{ component: 'lodash', version: '4.17.21' }], rec(['3.0.0']))).toEqual([]);
  });

  it('is case-insensitive on the package name', () => {
    expect(matchOsv([{ component: 'LoDash', version: '4.17.20' }], rec(['4.17.20']))).toHaveLength(1);
  });

  it('ignores an affected entry with no package name', () => {
    expect(matchOsv([{ component: 'lodash', version: '1' }], [{ id: 'G', affected: [{}] }])).toEqual([]);
  });

  it('ignores a record with no affected list at all', () => {
    expect(matchOsv([{ component: 'lodash', version: '1' }], [{ id: 'G' }])).toEqual([]);
  });

  it('takes the CVE from the id when there are no aliases', () => {
    const m = matchOsv([{ component: 'lodash', version: '1' }], [
      { id: 'CVE-2021-23337', affected: [{ package: { name: 'lodash' }, versions: ['1'] }] },
    ]);
    expect(m[0]!.cve).toBe('CVE-2021-23337');
  });
});
