import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, craRecord } from '../cra/commands.js';
import { readStream, append } from '../cra/store.js';
import { VERSION, TOOL_ID } from '../version.js';

/**
 * Decision 6: AI may write to the hypothesis table and never to the claim table,
 * with the model, prompt version and date stored on every hypothesis.
 *
 * The type boundary was enforced from the start. The provenance half was not,
 * and it is built here BEFORE any model writes anything, on purpose: adding it
 * afterwards would leave a window of machine output that cannot be attributed,
 * inside a record whose whole purpose is attribution.
 *
 * The load-bearing decision is that `model` and `promptVersion` are null rather
 * than absent for a deterministic finding. "Produced by a rule" and "nobody
 * recorded what produced this" must not read the same to someone holding the
 * record years later.
 */
const KEV = { vulnerabilities: [] };
const OSV = [
  {
    id: 'GHSA-x',
    aliases: ['CVE-2021-23337'],
    affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, versions: ['4.17.20'] }],
  },
];

let dir: string;
const out: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: () => {},
  now: () => new Date('2026-08-16T01:00:00Z'),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-prov-'));
  out.length = 0;
  craProduct(io(), { name: 'Widget', version: '1.0.0' });
  writeFileSync(
    join(dir, 'sbom.json'),
    JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'lodash', version: '4.17.20' }] }),
  );
  craIngest(io(), { sbom: join(dir, 'sbom.json') });
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify(KEV));
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Hyp = { provenance?: { tool: string; toolVersion: string; model: string | null; promptVersion: string | null } };

describe('every hypothesis records what produced it', () => {
  it('stamps the tool and the exact build', async () => {
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    const rows = readStream<Hyp>(dir, 'hypotheses');
    expect(rows).toHaveLength(1);
    const p = rows[0]!.body.provenance!;
    expect(p.tool).toBe(TOOL_ID);
    expect(p.toolVersion).toBe(VERSION);
  });

  it('says null for model and prompt, rather than leaving them out', async () => {
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });
    const p = readStream<Hyp>(dir, 'hypotheses')[0]!.body.provenance!;

    // Present-and-null, not absent. `in` distinguishes them; a truthiness check
    // would not, which is exactly how this field would rot.
    expect('model' in p).toBe(true);
    expect('promptVersion' in p).toBe(true);
    expect(p.model).toBeNull();
    expect(p.promptVersion).toBeNull();
  });

  it('carries provenance into the record, and therefore into the hash', async () => {
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    const { record } = craRecord(io(), {});
    expect(record!.hypotheses).toHaveLength(1);
    const p = record!.hypotheses[0]!.provenance;
    expect(p.tool).toBe(TOOL_ID);
    expect(p.toolVersion).toBe(VERSION);
    // Provenance that only exists in the local store cannot be checked by
    // whoever receives the record.
    expect(JSON.stringify(record)).toContain(TOOL_ID);
  });

  it('does not invent a producer for rows written before the field existed', () => {
    // A store written by an earlier build has hypotheses with no provenance.
    // The record must say so rather than stamp this build onto findings it did
    // not make, which would be a false attribution in the one artifact whose
    // purpose is attribution.
    append(dir, 'hypotheses', {
      product: 'p',
      component: 'legacy-pkg',
      cve: 'CVE-2020-0001',
      assertion: 'legacy row',
      basis: 'written before provenance existed',
      requiresHumanSignOff: true,
    } as unknown as Parameters<typeof append>[2], { now: io().now });

    const { record } = craRecord(io(), {});
    expect(record!.hypotheses).toHaveLength(1);
    const p = record!.hypotheses[0]!.provenance;
    expect(p.tool).toBe('unrecorded');
    expect(p.toolVersion).toBe('unrecorded');
    expect(p.tool).not.toBe(TOOL_ID);
  });

  it('adds no third timestamp: the envelope already dates the row', async () => {
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });
    const row = readStream<Hyp>(dir, 'hypotheses')[0]!;

    expect(row.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(row.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // Two answers to "when" is one too many; the spec says which to read.
    expect(row.body.provenance).not.toHaveProperty('at');
    expect(row.body.provenance).not.toHaveProperty('date');
  });
});
