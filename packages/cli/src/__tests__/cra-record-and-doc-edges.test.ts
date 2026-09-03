import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, craClaim, craAssess, craDoc, craRecord, craSupport } from '../cra/commands.js';

/**
 * The record and the documents once the store actually holds things.
 *
 * Both are built from `has it / does it not` pairs, and the suite only ever
 * saw the empty half. The full half is the one that produces an Article 31
 * document and a signed-hash record, so it is the half with consequences.
 */
let dir: string;
const out: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: () => {} });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-rd-'));
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const populate = async () => {
  craProduct(io(), { name: 'Acme Gateway', version: '2.4.0', productClass: 'important_class_ii' });
  writeFileSync(join(dir, 's.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] }));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify([{ id: 'G', aliases: ['CVE-2023-4863'], affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }] }]));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2023-4863', product: 'x', vulnerabilityName: 'x' }] }));
  craIngest(io(), { sbom: join(dir, 's.json') });
  await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });
  craClaim(io(), { cve: 'CVE-2023-4863', verdict: 'affected', by: 'Pedram Madani' });
  craSupport(io(), { until: '2032-01-01', placedOn: '2026-01-01', by: 'Pedram Madani', rationale: 'stated life' });
  out.length = 0;
};

describe('the record once it holds something', () => {
  it('counts claims and clocks and writes a stable hash', async () => {
    await populate();
    const r = craRecord(io(), {});
    expect(r.code).toBe(0);
    expect(r.record!.claims).toHaveLength(1);
    expect(r.record!.openClocks.length).toBeGreaterThan(0);
    expect(r.record!.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the SAME hash twice, so the signature signs content not the clock', async () => {
    await populate();
    const a = craRecord(io(), {}).record!.recordHash;
    const b = craRecord(io(), {}).record!.recordHash;
    expect(a).toBe(b);
  });

  it('a later asOf still includes what was known', async () => {
    await populate();
    const r = craRecord(io(), { asOf: '2099-01-01T00:00:00.000Z' });
    expect(r.record!.evidenceCount).toBeGreaterThan(0);
  });

  it('writes record.json to disk', async () => {
    await populate();
    craRecord(io(), {});
    const onDisk = JSON.parse(readFileSync(join(dir, 'compliance', 'cra', 'record.json'), 'utf8'));
    expect(onDisk.instrument).toContain('2024/2847');
  });
});

describe('the documents once the record holds something', () => {
  it('fills the technical file from the store and still names its gaps', async () => {
    await populate();
    craAssess(io(), { ref: 'Annex I Part I (1)', status: 'not_met', by: 'Pedram Madani', rationale: 'open finding' });
    out.length = 0;
    const code = craDoc(io(), { type: 'technical-file' });
    expect([0, 3]).toContain(code);
    const md = readFileSync(join(dir, 'compliance', 'cra', 'technical-documentation.md'), 'utf8');
    expect(md).toContain('Acme Gateway');
    expect(md).toContain('2032-01-01');
  });

  it('the declaration gaps the notified body for a class II product with none recorded', async () => {
    await populate();
    out.length = 0;
    craDoc(io(), { type: 'declaration' });
    expect(out.join('\n')).toContain('Annex V (7)');
  });
});
