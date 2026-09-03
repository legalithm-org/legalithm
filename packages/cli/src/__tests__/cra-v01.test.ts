import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { append, asOf, readStream, contentHash } from '../cra/store.js';
import {
  craProduct,
  craIngest,
  craWatch,
  craRecord,
  type CraIo,
  type KevCatalogue,
} from '../cra/commands.js';
import { assessCve, llvmAnalyser, type ReachabilityVerdict } from '../cra/reachability/index.js';
import { craClaim } from '../cra/commands.js';

let cwd: string;
let out: string[];
let err: string[];
let io: CraIo;

/**
 * VERBATIM CISA shape. The previous fixture read
 * 'Google Chrome libwebp Heap Buffer Overflow', a string invented so that the
 * component name appeared inside it. Real KEV names the SHIPPING PRODUCT
 * ("Chromium WebP") and never the library ("libwebp"), which is why the old
 * substring join passed these tests and failed on real data.
 */
const KEV: KevCatalogue = {
  vulnerabilities: [
    {
      cveID: 'CVE-2023-4863',
      vendorProject: 'Google',
      product: 'Chromium WebP',
      vulnerabilityName: 'Google Chromium WebP Heap-Based Buffer Overflow Vulnerability',
    },
    {
      cveID: 'CVE-2021-44228',
      vendorProject: 'Apache',
      product: 'Log4j2',
      vulnerabilityName: 'Apache Log4j2 Remote Code Execution Vulnerability',
    },
  ],
};

/**
 * The component-to-CVE source. KEV cannot supply this: it says which CVEs are
 * exploited, not which of your components carry them.
 */
const OSV_DUMP = JSON.stringify([
  {
    id: 'GHSA-j7hp-h8jx-5ppr',
    aliases: ['CVE-2023-4863'],
    summary: 'libwebp heap buffer overflow',
    affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }],
  },
]);

/** Written into every temp cwd by the root beforeEach. */
const osvPath = () => join(cwd, 'osv.json');

const CYCLONEDX = JSON.stringify({
  bomFormat: 'CycloneDX',
  components: [
    { name: 'openssl', version: '3.0.11' },
    { name: 'libwebp', version: '1.3.1' },
  ],
});

const SPDX = JSON.stringify({
  packages: [{ name: 'zlib', versionInfo: '1.3.1' }],
});

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cra-'));
  writeFileSync(join(cwd, 'osv.json'), OSV_DUMP);
  out = [];
  err = [];
  io = {
    cwd,
    log: (m) => out.push(m),
    error: (m) => err.push(m),
    fetchKev: async () => KEV,
  };
});

function registerProduct(cls = 'important_class_ii') {
  return craProduct(io, { name: 'Acme Gateway', version: '2.4.0', productClass: cls });
}

describe('CRA store', () => {
  /**
   * Identity is the assertion, not the write time. The first version folded a
   * defaulted observedAt (which is just "now") into the id, so re-running the
   * same CI step appended the same SBOM again on every run.
   */
  it('is idempotent for identical evidence', () => {
    const body = { product: 'p', component: 'openssl', assertion: 'contains openssl 3.0.11' };
    const a = append(cwd, 'evidence', body);
    const b = append(cwd, 'evidence', body);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.event.id).toBe(a.event.id);
    expect(readStream(cwd, 'evidence')).toHaveLength(1);
  });

  it('treats an explicitly back-dated observation as a distinct fact', () => {
    const body = { product: 'p', component: 'openssl', assertion: 'contains openssl 3.0.11' };
    append(cwd, 'evidence', body);
    const back = append(cwd, 'evidence', body, { observedAt: '2026-01-01T00:00:00.000Z' });
    expect(back.created).toBe(true);
    expect(readStream(cwd, 'evidence')).toHaveLength(2);
  });

  it('carries both clocks on every event', () => {
    const { event } = append(cwd, 'evidence', { a: 1 }, { observedAt: '2026-01-01T00:00:00.000Z' });
    expect(event.observedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(event.recordedAt).not.toBe(event.observedAt);
  });

  /** The query an auditor makes: what did you know on a given date. */
  it('asOf hides what was recorded after the cutoff', () => {
    append(cwd, 'evidence', { n: 1 }, { now: () => new Date('2026-01-01T00:00:00Z') });
    append(cwd, 'evidence', { n: 2 }, { now: () => new Date('2026-06-01T00:00:00Z') });
    const events = readStream(cwd, 'evidence');
    expect(asOf(events, '2026-03-01T00:00:00.000Z')).toHaveLength(1);
    expect(asOf(events)).toHaveLength(2);
  });

  it('asOf drops superseded events without deleting them', () => {
    const first = append(cwd, 'claims', { verdict: 'affected' });
    append(cwd, 'claims', { verdict: 'not_affected' }, { supersedes: first.event.id });
    expect(readStream(cwd, 'claims')).toHaveLength(2);
    const live = asOf(readStream(cwd, 'claims'));
    expect(live).toHaveLength(1);
    expect((live[0]!.body as { verdict: string }).verdict).toBe('not_affected');
  });

  it('canonicalises so key order cannot change an id', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});

describe('cra product', () => {
  it('states the conformity route implied by the class', () => {
    expect(registerProduct('important_class_ii')).toBe(0);
    expect(out.join('\n')).toContain('Article 32(3): notified body required');
  });

  it('warns that class I has no self-assessment route in practice today', () => {
    registerProduct('important_class_i');
    expect(out.join('\n')).toContain('None is cited in the OJ');
  });

  it('nags about the support period, which Article 13(8) requires', () => {
    registerProduct();
    expect(out.join('\n')).toContain('Article 13(8)');
  });

  it('rejects an unknown class rather than guessing', () => {
    expect(craProduct(io, { name: 'x', version: '1', productClass: 'nope' })).toBe(1);
    expect(err.join('\n')).toContain('Unknown --class');
  });
});

describe('cra ingest', () => {
  beforeEach(() => {
    registerProduct();
  });

  it('reads CycloneDX', () => {
    const p = join(cwd, 'sbom.json');
    writeFileSync(p, CYCLONEDX);
    expect(craIngest(io, { sbom: p })).toBe(0);
    expect(readStream(cwd, 'evidence')).toHaveLength(2);
  });

  it('reads SPDX', () => {
    const p = join(cwd, 'spdx.json');
    writeFileSync(p, SPDX);
    expect(craIngest(io, { sbom: p })).toBe(0);
    expect(readStream(cwd, 'evidence')).toHaveLength(1);
  });

  /**
   * A declaration is a person putting their name to something. Without a name
   * it is an anonymous assertion, and an anonymous assertion is not evidence.
   */
  it('refuses a declaration with no named signer', () => {
    expect(craIngest(io, { declare: 'contains openssl 3.0.11' })).toBe(1);
    expect(err.join('\n')).toContain('--by');
    expect(readStream(cwd, 'evidence')).toHaveLength(0);
  });

  it('records the signer on an attestation', () => {
    craIngest(io, { declare: 'not reachable', by: 'Pedram Madani <p@example.com>' });
    const [row] = readStream<{ sourceType: string; sourceIdentity: string }>(cwd, 'evidence');
    expect(row!.body.sourceType).toBe('attestation');
    expect(row!.body.sourceIdentity).toContain('Pedram Madani');
  });
});

describe('cra watch', () => {
  beforeEach(() => {
    registerProduct();
    const p = join(cwd, 'sbom.json');
    writeFileSync(p, CYCLONEDX);
    craIngest(io, { sbom: p });
    out = [];
  });

  /** THE rule: a machine cannot produce a claim, whatever it finds. */
  it('writes a hypothesis and never a claim', async () => {
    await craWatch(io, { osv: osvPath(), becameAwareNow: true });
    expect(readStream(cwd, 'hypotheses')).toHaveLength(1);
    expect(readStream(cwd, 'claims')).toHaveLength(0);
    const [h] = readStream<{ cve: string; requiresHumanSignOff: boolean }>(cwd, 'hypotheses');
    expect(h!.body.cve).toBe('CVE-2023-4863');
    expect(h!.body.requiresHumanSignOff).toBe(true);
  });

  it('starts the three Article 14(2) clocks, correctly cited', async () => {
    await craWatch(io, { osv: osvPath(), becameAwareNow: true });
    const clocks = readStream<{ article: string }>(cwd, 'clocks');
    expect(clocks.map((c) => c.body.article).sort()).toEqual(['14(2)(a)', '14(2)(b)', '14(2)(c)']);
    // Article 11 is General product safety. It must never appear here.
    expect(JSON.stringify(clocks)).not.toContain('"11(');
  });

  it('exits non-zero on a hit so CI notices', async () => {
    expect(await craWatch(io, { osv: osvPath(), becameAwareNow: true })).toBe(2);
  });

  it('does not call a miss "not affected"', async () => {
    writeFileSync(join(cwd, 'clean.json'), JSON.stringify({ components: [{ name: 'ncurses' }] }));
    const fresh = mkdtempSync(join(tmpdir(), 'cra-'));
    const io2: CraIo = { ...io, cwd: fresh, log: (m) => out.push(m) };
    craProduct(io2, { name: 'x', version: '1' });
    craIngest(io2, { sbom: join(cwd, 'clean.json') });
    out = [];
    expect(await craWatch(io2, { osv: osvPath(), becameAwareNow: true })).toBe(0);
    expect(out.join('\n').toLowerCase()).toContain('not "not affected"');
  });
});

describe('cra record', () => {
  beforeEach(async () => {
    registerProduct();
    const p = join(cwd, 'sbom.json');
    writeFileSync(p, CYCLONEDX);
    craIngest(io, { sbom: p });
    await craWatch(io, { osv: osvPath(), becameAwareNow: true });
    out = [];
  });

  /**
   * Identical evidence must produce an identical hash, or the signature signs
   * the clock rather than the content. Both `generatedAt` and a defaulted
   * `asOf` had to come out of the hashed body to get there.
   */
  it('hashes the content, not the moment it was rendered', () => {
    const a = craRecord({ ...io, now: () => new Date('2026-08-14T10:00:00Z') }, {});
    const b = craRecord({ ...io, now: () => new Date('2026-08-14T18:30:00Z') }, {});
    expect(a.record!.recordHash).toBe(b.record!.recordHash);
    expect(a.record!.generatedAt).not.toBe(b.record!.generatedAt);
  });

  it('changes the hash when the evidence changes', () => {
    const before = craRecord(io, {}).record!.recordHash;
    craIngest(io, { declare: 'libwebp not reachable', by: 'Pedram Madani <p@example.com>' });
    expect(craRecord(io, {}).record!.recordHash).not.toBe(before);
  });

  it('reports machine findings as under_investigation, never as claims', () => {
    const { record } = craRecord(io, {});
    expect(record!.hypotheses).toHaveLength(1);
    expect(record!.hypotheses[0]!.status).toBe('under_investigation');
    expect(record!.claims).toHaveLength(0);
  });

  it('refuses to present itself as a declaration of conformity', () => {
    const { record } = craRecord(io, {});
    expect(record!.notice).toContain('not a declaration of conformity');
    expect(record!.notice).toContain('stays with');
  });

  it('writes the record where a customer keeps it', () => {
    craRecord(io, {});
    const p = join(cwd, 'compliance', 'cra', 'record.json');
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, 'utf8')).schema).toBe('legalithm.cra.record/v0.4');
  });
});

describe('cra watch with reachability', () => {
  beforeEach(() => {
    registerProduct();
    const p = join(cwd, 'sbom.json');
    writeFileSync(p, CYCLONEDX);
    craIngest(io, { sbom: p });
    out = [];
  });

  const withVerdict = (v: ReachabilityVerdict): CraIo => ({ ...io, assessCve: () => v });

  /**
   * The verdict is evidence, not a determination. Even not_affected, which is
   * the whole commercial point, lands on a hypothesis for a human to convert.
   */
  it('records the verdict on a hypothesis, never on a claim', async () => {
    const io2 = withVerdict({ status: 'not_affected', rationale: 'unreachable under the sound analysis' });
    await craWatch(io2, { ir: 'll', entry: 'main', osv: osvPath(), becameAwareNow: true });
    const [h] = readStream<{ reachability?: ReachabilityVerdict }>(cwd, 'hypotheses');
    expect(h!.body.reachability?.status).toBe('not_affected');
    expect(readStream(cwd, 'claims')).toHaveLength(0);
  });

  /**
   * The judgment call, pinned. Article 14 triggers on a vulnerability CONTAINED
   * IN the product; reachability speaks to Annex I conformity. Gating the clock
   * on a verdict this tool is not entitled to make would risk under-reporting,
   * which is the dangerous direction.
   */
  it('starts the Article 14 clocks even when reachability says not_affected', async () => {
    const io2 = withVerdict({ status: 'not_affected', rationale: 'unreachable' });
    await craWatch(io2, { ir: 'll', entry: 'main', osv: osvPath(), becameAwareNow: true });
    expect(readStream(cwd, 'clocks')).toHaveLength(3);
    expect(out.join('\n')).toContain('not gated on reachability');
  });

  it('keeps the call path when the verdict is affected', async () => {
    const io2 = withVerdict({
      status: 'affected',
      rationale: 'reachable',
      callPath: ['main', 'read', 'inflate', 'inflate_fast'],
    });
    await craWatch(io2, { ir: 'll', entry: 'main', osv: osvPath(), becameAwareNow: true });
    const [h] = readStream<{ reachability?: ReachabilityVerdict }>(cwd, 'hypotheses');
    expect(h!.body.reachability?.callPath).toContain('inflate_fast');
    expect(out.join('\n')).toContain('path: main -> read');
  });

  it('says plainly when reachability was not run', async () => {
    await craWatch(io, { osv: osvPath(), becameAwareNow: true });
    expect(out.join('\n')).toContain('Reachability was NOT run');
    expect(out.join('\n')).toContain('presence findings, not exploitability');
  });
});

describe('reachability symbol map', () => {
  /**
   * KEV carries no function names and no open dataset maps CVE to symbol. An
   * unmapped CVE is undecided, and says so, rather than being guessed either way.
   */
  it('returns under_investigation for an unmapped CVE, with the reason', () => {
    const v = assessCve(
      {
        entry: 'main',
        symbols: {},
        analyser: llvmAnalyser({ irDirs: ['ll'], analyserPath: '/nonexistent', run: () => ({ status: 0, stdout: '', stderr: '' }) }),
      },
      'CVE-2023-4863',
    );
    expect(v.status).toBe('under_investigation');
    expect(v.rationale).toContain('No vulnerable symbol is mapped');
  });

  it('is affected if ANY mapped symbol is reachable', () => {
    const calls: string[] = [];
    const v = assessCve(
      {
        entry: 'main',
        symbols: { 'CVE-2023-4863': ['SafeFn', 'BuildHuffmanTable'] },
        analyser: llvmAnalyser({
          irDirs: ['ll'],
          analyserPath: __filename, // exists, so the guard passes
          run: (args: string[]) => {
            const target = args[args.indexOf('--target') + 1]!;
            calls.push(target);
            return {
              status: 0,
              stdout: target === 'BuildHuffmanTable' ? 'VEX STATUS: affected' : 'VEX STATUS: not_affected',
              stderr: '',
            };
          },
        }),
      },
      'CVE-2023-4863',
    );
    expect(v.status).toBe('affected');
    expect(calls).toContain('BuildHuffmanTable');
  });

  it('is not_affected only when every mapped symbol is unreachable', () => {
    const v = assessCve(
      {
        entry: 'main',
        symbols: { 'CVE-1': ['a', 'b'] },
        analyser: llvmAnalyser({
          irDirs: ['ll'],
          analyserPath: __filename,
          run: () => ({ status: 0, stdout: 'VEX STATUS: not_affected', stderr: '' }),
        }),
      },
      'CVE-1',
    );
    expect(v.status).toBe('not_affected');
    expect(v.rationale).toContain('sound over-approximation');
  });

  it('treats a missing verdict as undecided, never as not affected', () => {
    const v = assessCve(
      {
        entry: 'main',
        symbols: { 'CVE-1': ['a'] },
        analyser: llvmAnalyser({
          irDirs: ['ll'],
          analyserPath: __filename,
          run: () => ({ status: 1, stdout: 'analyser blew up', stderr: 'boom' }),
        }),
      },
      'CVE-1',
    );
    expect(v.status).toBe('under_investigation');
  });
});

describe('cra record carries the machine verdict', () => {
  beforeEach(() => {
    registerProduct();
    const p = join(cwd, 'sbom.json');
    writeFileSync(p, CYCLONEDX);
    craIngest(io, { sbom: p });
  });

  /**
   * The record is the artifact that gets handed over. Flattening every finding
   * to under_investigation threw the analyser's work away exactly where it
   * mattered most, while keeping the verdict without marking it unsigned would
   * publish a VEX statement nobody put their name to. Both, explicitly.
   */
  it('keeps the verdict AND marks it unsigned', async () => {
    const io2: CraIo = {
      ...io,
      assessCve: () => ({
        status: 'not_affected',
        rationale: 'unreachable under the sound over-approximation',
      }),
    };
    await craWatch(io2, { ir: 'll', entry: 'main', osv: osvPath(), becameAwareNow: true });
    const { record } = craRecord(io2, {});
    const [h] = record!.hypotheses;
    expect(h!.machineVerdict).toBe('not_affected');
    expect(h!.status).toBe('under_investigation');
    expect(h!.signedBy).toBeNull();
    expect(h!.rationale).toContain('sound over-approximation');
  });

  it('says not_assessed when no analyser ran, rather than implying safety', async () => {
    await craWatch(io, { osv: osvPath(), becameAwareNow: true });
    const { record } = craRecord(io, {});
    expect(record!.hypotheses[0]!.machineVerdict).toBe('not_assessed');
  });

  it('carries the call path into the record when affected', async () => {
    const io2: CraIo = {
      ...io,
      assessCve: () => ({
        status: 'affected',
        rationale: 'reachable',
        callPath: ['inflate', 'inflate_fast'],
      }),
    };
    await craWatch(io2, { ir: 'll', entry: 'main', osv: osvPath(), becameAwareNow: true });
    const { record } = craRecord(io2, {});
    expect(record!.hypotheses[0]!.callPath).toEqual(['inflate', 'inflate_fast']);
  });
});

describe('cra claim: the door through the hypothesis/claim boundary', () => {
  beforeEach(async () => {
    registerProduct();
    const p = join(cwd, 'sbom.json');
    writeFileSync(p, CYCLONEDX);
    craIngest(io, { sbom: p });
    await craWatch(io, { osv: osvPath(), becameAwareNow: true });
    out = [];
    err = [];
  });

  it('records a claim against an existing hypothesis', () => {
    expect(
      craClaim(io, {
        cve: 'CVE-2023-4863',
        verdict: 'not_affected',
        by: 'Pedram Madani <p@example.com>',
        rationale: 'unreachable from every entry point',
      }),
    ).toBe(0);
    const claims = readStream<{ verdict: string; declaredBy: string; fromHypothesisId?: string }>(cwd, 'claims');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.body.verdict).toBe('not_affected');
    expect(claims[0]!.body.fromHypothesisId).toBeTruthy();
  });

  /** VEX requires a justification for not_affected, and it is the claim that discharges a duty. */
  it('refuses not_affected without a rationale', () => {
    expect(craClaim(io, { cve: 'CVE-2023-4863', verdict: 'not_affected', by: 'X' })).toBe(1);
    expect(err.join('\n')).toContain('--rationale');
    expect(readStream(cwd, 'claims')).toHaveLength(0);
  });

  it('refuses a claim with no named human', () => {
    expect(craClaim(io, { cve: 'CVE-2023-4863', verdict: 'affected' })).toBe(1);
    expect(readStream(cwd, 'claims')).toHaveLength(0);
  });

  /** under_investigation is the absence of a claim, not something to assert. */
  it('refuses under_investigation as a verdict', () => {
    expect(craClaim(io, { cve: 'CVE-2023-4863', verdict: 'under_investigation', by: 'X' })).toBe(1);
    expect(err.join('\n')).toContain('not assertable');
  });

  it('refuses a claim about a CVE nothing found', () => {
    expect(craClaim(io, { cve: 'CVE-0000-0000', verdict: 'affected', by: 'X' })).toBe(1);
    expect(err.join('\n')).toContain('No hypothesis');
  });

  it('upgrades the record status and names the signer', () => {
    craClaim(io, {
      cve: 'CVE-2023-4863',
      verdict: 'not_affected',
      by: 'Pedram Madani <p@example.com>',
      rationale: 'unreachable',
    });
    const { record } = craRecord(io, {});
    const h = record!.hypotheses[0]!;
    expect(h.status).toBe('not_affected');
    expect(h.signedBy).toContain('Pedram Madani');
    expect(record!.claims).toHaveLength(1);
  });

  /** Changing your mind is a new event that supersedes, never an edit. */
  it('supersedes rather than edits', () => {
    craClaim(io, { cve: 'CVE-2023-4863', verdict: 'not_affected', by: 'A', rationale: 'r1' });
    const first = readStream(cwd, 'claims')[0]!;
    craClaim(io, { cve: 'CVE-2023-4863', verdict: 'affected', by: 'A', supersedes: first.id });
    expect(readStream(cwd, 'claims')).toHaveLength(2);
    const { record } = craRecord(io, {});
    expect(record!.hypotheses[0]!.status).toBe('affected');
    expect(record!.claims).toHaveLength(1);
  });

  /** Signing does not withdraw a reporting clock. */
  it('leaves the Article 14 clocks running', () => {
    craClaim(io, { cve: 'CVE-2023-4863', verdict: 'not_affected', by: 'A', rationale: 'r' });
    expect(readStream(cwd, 'clocks')).toHaveLength(3);
    expect(out.join('\n')).toContain('does NOT withdraw an');
  });
});
