import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, craDoc, craRecord } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * Found by running the pipeline over curl 8.11.1.
 *
 * It produced a record with three Article 14 clocks for a product neither
 * Legalithm nor its user makes. Every CRA obligation lands on an economic
 * operator: analysing someone else's product gives you no duty to notify ENISA
 * and no standing to declare its conformity. A record that cannot tell the two
 * apart reads as a conformity record for a product its author has no
 * relationship to, which is the one thing this architecture exists to prevent.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });

const KEV = { vulnerabilities: [{ cveID: 'CVE-2016-9841', product: 'zlib', vulnerabilityName: 'x' }] };
const OSV = [{ id: 'O', aliases: ['CVE-2016-9841'], affected: [{ package: { name: 'zlib' }, versions: ['1.3.1'] }] }];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-tp-'));
  out.length = 0;
  err.length = 0;
  writeFileSync(join(dir, 'sbom.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'zlib', version: '1.3.1' }] }));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify(KEV));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const watch = () => craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });

describe('third-party analysis', () => {
  it('refuses without naming who actually makes it', () => {
    expect(craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true })).toBe(1);
    expect(err.join('\n')).toContain('attributable to nobody');
  });

  it('records who the manufacturer is', () => {
    craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true, manufacturer: 'the curl project' });
    const [p] = readStream<{ analysisOnly?: boolean; manufacturer?: string }>(dir, 'products');
    expect(p!.body.analysisOnly).toBe(true);
    expect(p!.body.manufacturer).toBe('the curl project');
  });

  it('starts NO Article 14 clock, however exploited the finding is', async () => {
    craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true, manufacturer: 'the curl project' });
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    out.length = 0;
    await watch();
    expect(readStream(dir, 'clocks')).toHaveLength(0);
    expect(out.join('\n')).toContain('THIRD-PARTY ANALYSIS');
    expect(out.join('\n')).toContain('belongs to whoever placed this product on the market');
  });

  it('still reports the finding: analysis is the point', async () => {
    craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true, manufacturer: 'the curl project' });
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    out.length = 0;
    await watch();
    expect(out.join('\n')).toContain('CVE-2016-9841');
    expect(readStream(dir, 'hypotheses')).toHaveLength(1);
  });

  it('refuses to draw up a declaration in the manufacturer\'s name', () => {
    craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true, manufacturer: 'the curl project' });
    err.length = 0;
    expect(craDoc(io(), { type: 'declaration' })).toBe(1);
    expect(err.join('\n')).toContain('sole responsibility');
    expect(err.join('\n')).toContain("someone else's name");
  });

  it('refuses the technical file too, which Article 31 puts on the manufacturer', () => {
    craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true, manufacturer: 'the curl project' });
    expect(craDoc(io(), { type: 'technical-file' })).toBe(1);
  });

  it('leaves an ordinary product completely unaffected', async () => {
    craProduct(io(), { name: 'Acme Gateway', version: '2.4.0' });
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    out.length = 0;
    await watch();
    // Three clocks, because this one IS ours.
    expect(readStream(dir, 'clocks')).toHaveLength(3);
    expect(out.join('\n')).not.toContain('THIRD-PARTY');
    // 3 means "generated, with gaps", which is the normal outcome. The point
    // is that it is not 1, the third-party refusal.
    expect(craDoc(io(), { type: 'declaration' })).not.toBe(1);
  });

  it('keeps clocks out of the record for an analysed product', async () => {
    craProduct(io(), { name: 'curl', version: '8.11.1', thirdParty: true, manufacturer: 'the curl project' });
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    await watch();
    out.length = 0;
    craRecord(io(), {});
    expect(out.find((l) => l.includes('open clocks'))).toContain('0');
  });
});
