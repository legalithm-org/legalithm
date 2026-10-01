/**
 * Four things a BSI test lab noticed in the first minutes of a dry run on
 * 18 Sep 2026 (see the vault: seo-raw/legalithm-2026-09-18-secuvera-demo/RUN.md):
 *
 * 1. `cra <sub> --help` printed the global help, cut off.
 * 2. `cra classify` rendered the Annex I Part I duties as "(1) (2) (2) (2) ...".
 * 3. `verify-record compliance/cra/record.json` asked for the AI Act record.
 * 4. A Maven component never matched its OSV record, so log4j was invisible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../index.js';
import { CRA_USAGE, craUsageLines } from '../cra/usage.js';
import { groupDutyRefs } from '../cra/duties.js';
import { osvNameFromPurl, craProduct, craIngest } from '../cra/commands.js';
import { matchOsv } from '../cra/intel.js';
import { readStream } from '../cra/store.js';

let dir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
const logged: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-edges-'));
  logged.length = 0;
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  logSpy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logged.push(String(m)); });
  errSpy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logged.push(String(m)); });
});
afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

const said = () => logged.join('\n');

describe('1. cra <sub> --help answers the question that was asked', () => {
  for (const sub of Object.keys(CRA_USAGE)) {
    it(`cra ${sub} --help prints that subcommand's usage, not the global help`, async () => {
      const code = await main(['cra', sub, '--help']);
      expect(code).toBe(0);
      expect(said()).toContain(`Usage: legalithm cra ${sub}`);
      expect(said()).not.toContain('Commands:');
      expect(said()).not.toContain('Wire Legalithm into Claude Code');
    });
  }
  it('cra --help lists the subcommands', async () => {
    expect(await main(['cra', '--help'])).toBe(0);
    expect(said()).toContain('Usage: legalithm cra <subcommand>');
    expect(said()).toContain('report');
  });
  it('-h works the same way', async () => {
    expect(await main(['cra', 'watch', '-h'])).toBe(0);
    expect(said()).toContain('Usage: legalithm cra watch');
  });
  it('the usage table covers every routed subcommand', () => {
    for (const sub of ['classify', 'product', 'ingest', 'watch', 'simulate', 'claim', 'report', 'advise', 'record', 'support', 'doc', 'assess', 'risk', 'policy', 'monitor', 'push', 'supplier']) {
      expect(craUsageLines(sub)[0], sub).toContain(`legalithm cra ${sub}`);
    }
  });
});

describe('2. duties keep their lettered points', () => {
  it('renders Annex I Part I as (1) (2)(a) ... (2)(m), not thirteen "(2)"', () => {
    const refs = ['(1)', ...'abcdefghijklm'.split('').map((l) => `(2)(${l})`)];
    const obligations = refs.map((r) => ({ ref: `Annex I Part I ${r}`, title: 'Annex I Part I: properties' }));
    const [group] = groupDutyRefs(obligations);
    expect(group!.article).toBe('Annex I Part I');
    expect(group!.points.join(' ')).toBe('(1) (2)(a) (2)(b) (2)(c) (2)(d) (2)(e) (2)(f) (2)(g) (2)(h) (2)(i) (2)(j) (2)(k) (2)(l) (2)(m)');
  });
  it('keeps articles apart and paragraphs in order', () => {
    const groups = groupDutyRefs([
      { ref: 'Article 13(1)', title: 'Article 13: Obligations of manufacturers' },
      { ref: 'Article 13(2)', title: 'Article 13: Obligations of manufacturers' },
      { ref: 'Annex I Part II (1)', title: 'Annex I Part II' },
      { ref: 'Article 14(1)', title: 'Article 14: Reporting' },
    ]);
    expect(groups.map((g) => g.article)).toEqual(['Article 13', 'Annex I Part II', 'Article 14']);
    expect(groups[0]!.points).toEqual(['(1)', '(2)']);
    expect(groups[0]!.title).toBe('Obligations of manufacturers');
  });
});

describe('3. verify-record knows a CRA record when it sees one', () => {
  it('verifies compliance/cra/record.json the CRA way instead of asking for the AI Act record', async () => {
    craProduct({ cwd: dir, log: () => {}, error: () => {} }, { name: 'demo', version: '1.0.0' });
    expect(await main(['cra', 'record'])).toBe(0);
    expect(existsSync(join(dir, 'compliance', 'cra', 'record.json'))).toBe(true);
    logged.length = 0;
    const code = await main(['verify-record', join(dir, 'compliance', 'cra', 'record.json')]);
    expect(said()).not.toContain('No compliance/legalithm.json found');
    expect(said()).toContain('Record integrity OK');
    expect(code).toBe(0);
  });
  it('points a CRA record that is not at its canonical path to cra record --verify', async () => {
    const stray = join(dir, 'somewhere', 'record.json');
    mkdirSync(join(dir, 'somewhere'), { recursive: true });
    writeFileSync(stray, JSON.stringify({ schema: 'legalithm.cra.record/v0.4', recordHash: 'x' }));
    const code = await main(['verify-record', stray]);
    expect(code).toBe(1);
    expect(said()).toContain('cra record --verify');
    expect(said()).not.toContain('run `legalithm init` first');
  });
});

describe('4. Maven components meet their OSV records', () => {
  it('derives the OSV package name from a purl per ecosystem', () => {
    expect(osvNameFromPurl('pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1')).toBe('org.apache.logging.log4j:log4j-core');
    expect(osvNameFromPurl('pkg:npm/%40babel/runtime@7.29.7')).toBe('@babel/runtime');
    expect(osvNameFromPurl('pkg:npm/semver@7.8.5')).toBe('semver');
    expect(osvNameFromPurl('pkg:pypi/Pillow@9.0.0')).toBe('pillow');
    expect(osvNameFromPurl('pkg:golang/github.com/gin-gonic/gin@v1.9.0')).toBe('github.com/gin-gonic/gin');
    expect(osvNameFromPurl('pkg:cargo/openssl@0.10.0')).toBe('openssl');
    expect(osvNameFromPurl('not a purl')).toBeNull();
  });

  it('ingests log4j-core under its Maven coordinate and matchOsv finds CVE-2021-44228', () => {
    const io = { cwd: dir, log: () => {}, error: () => {} };
    craProduct(io, { name: 'gateway', version: '2.3.1' });
    writeFileSync(join(dir, 'sbom.json'), JSON.stringify({
      bomFormat: 'CycloneDX', specVersion: '1.5',
      components: [{ type: 'library', group: 'org.apache.logging.log4j', name: 'log4j-core', version: '2.14.1', purl: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1' }],
    }));
    expect(craIngest(io, { sbom: join(dir, 'sbom.json') })).toBe(0);
    const rows = readStream<{ component: string; version: string }>(dir, 'evidence').map((e) => e.body);
    const names = rows.map((r) => r.component);
    expect(names).toContain('org.apache.logging.log4j:log4j-core');
    expect(names).not.toContain('log4j-core');

    // The shape of the real OSV record for GHSA-jfh8-c2jp-5v3q (CVE-2021-44228).
    const matches = matchOsv(rows.map((r) => ({ component: r.component, version: r.version })), [
      {
        id: 'GHSA-jfh8-c2jp-5v3q', aliases: ['CVE-2021-44228'], summary: 'Remote code injection in Log4j',
        affected: [{ package: { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' }, versions: ['2.14.1'] }],
      },
    ]);
    expect(matches.map((m) => m.cve)).toContain('CVE-2021-44228');
    expect(matches[0]!.confidence).toBe('exact');
  });

  it('a dotted group with no purl is treated as a Maven groupId', () => {
    const io = { cwd: dir, log: () => {}, error: () => {} };
    craProduct(io, { name: 'gateway', version: '2.3.1' });
    writeFileSync(join(dir, 'sbom.json'), JSON.stringify({
      bomFormat: 'CycloneDX', specVersion: '1.5',
      components: [{ type: 'library', group: 'com.fasterxml.jackson.core', name: 'jackson-databind', version: '2.9.8' }],
    }));
    craIngest(io, { sbom: join(dir, 'sbom.json') });
    const names = readStream<{ component: string }>(dir, 'evidence').map((e) => e.body.component);
    expect(names).toContain('com.fasterxml.jackson.core:jackson-databind');
  });
});
