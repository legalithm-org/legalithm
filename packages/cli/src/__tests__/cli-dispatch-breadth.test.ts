import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../index.js';

/**
 * Breadth across the router, which had 26 uncovered functions and 50 uncovered
 * branches: every subcommand it can dispatch, and the usage path each takes
 * when its required flags are absent.
 *
 * A router is exactly where a flag goes missing without anyone noticing, since
 * every command's own tests call the command directly and never travel through
 * argv.
 */
let dir: string;
const logged: string[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-b-'));
  logged.length = 0;
  spies = [
    vi.spyOn(process, 'cwd').mockReturnValue(dir),
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logged.push(String(m)); }),
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logged.push(String(m)); }),
  ];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});
const said = () => logged.join('\n');

describe('top-level routing', () => {
  it('prints help for no command', async () => {
    await main([]);
    expect(said().length).toBeGreaterThan(0);
  });

  it('rejects an unknown top-level command', async () => {
    expect(await main(['definitely-not-a-command'])).not.toBe(0);
  });

  it('answers --help', async () => {
    await main(['--help']);
    expect(said()).toMatch(/legalithm|usage/i);
  });

  it('answers --version with something version-shaped', async () => {
    await main(['--version']);
    expect(said()).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe('every cra subcommand is reachable and states its usage', () => {
  const needsFlags = ['ingest', 'claim', 'report', 'advise', 'doc'];
  it.each(needsFlags)('%s prints usage when its required flags are absent', async (sub) => {
    const code = await main(['cra', sub]);
    expect(code, `${sub} should not silently succeed`).not.toBe(0);
    expect(said().length).toBeGreaterThan(0);
  });

  it('assess runs against an empty store', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    expect(await main(['cra', 'assess'])).toBe(3);
  });

  it('assess --gaps takes the other branch', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    await main(['cra', 'assess', '--gaps']);
    expect(said()).toMatch(/Annex I/);
  });

  it('support routes and reports not set', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    expect(await main(['cra', 'support'])).toBe(3);
  });

  it('support forwards its four recording flags', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    const code = await main(['cra', 'support', '--until', '2032-01-01', '--placed-on', '2026-01-01',
      '--by', 'Pedram Madani', '--rationale', 'expected use']);
    expect(code).toBe(0);
  });

  it('record routes and refuses on an empty store', async () => {
    expect(await main(['cra', 'record'])).toBe(1);
  });

  it('record routes with a product present', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    expect(await main(['cra', 'record'])).toBe(0);
  });

  it('doc forwards --type and --out', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    await main(['cra', 'doc', '--type', 'technical-file', '--out', join(dir, 'tf.md')]);
    expect(said()).toContain('Annex VII');
  });

  it('advise forwards its mitigation and issued-at flags', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    const code = await main(['cra', 'advise', '--cve', 'CVE-1', '--mitigation', 'Upgrade; Disable preview',
      '--affected-versions', '1.0.0', '--issued-at', '2026-08-15']);
    expect(code).toBe(0); // every field filled, so no gaps
    expect(said()).toContain('Article 14(8)');
  });

  it('claim forwards --supersedes without crashing when there is no hypothesis', async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    logged.length = 0;
    expect(await main(['cra', 'claim', '--cve', 'CVE-1', '--verdict', 'affected',
      '--by', 'Pedram Madani', '--supersedes', 'abc'])).toBe(1);
  });
});

describe('watch flag forwarding, the failure that already happened once', () => {
  const seed = async () => {
    await main(['cra', 'product', '--name', 'p', '--version', '1']);
    writeFileSync(join(dir, 's.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] }));
    await main(['cra', 'ingest', '--sbom', join(dir, 's.json')]);
    writeFileSync(join(dir, 'osv.json'), JSON.stringify([{ id: 'G', aliases: ['CVE-2023-4863'], affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }] }]));
    writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2023-4863', product: 'x', vulnerabilityName: 'x' }] }));
    logged.length = 0;
  };

  it('forwards --ir, --entry, --symbols so reachability actually runs', async () => {
    await seed();
    writeFileSync(join(dir, 'sym.json'), JSON.stringify({ 'CVE-2023-4863': ['inflate_fast'] }));
    await main(['cra', 'watch', '--kev', join(dir, 'kev.json'), '--osv', join(dir, 'osv.json'),
      '--ir', join(dir, 'll'), '--entry', 'main', '--symbols', join(dir, 'sym.json'),
      '--analyser', '/definitely/not/here.py', '--became-aware-now']);
    // The analyser path is deliberately absent: the point is that the flags
    // ARRIVED, which shows up as an undecided verdict rather than silence.
    expect(said()).toMatch(/under_investigation|not usable|Reachability/i);
  });

  it('forwards --epss without an OSV source still being refused', async () => {
    await seed();
    writeFileSync(join(dir, 'epss.csv'), 'cve,epss,percentile\nCVE-2023-4863,0.9,0.99\n');
    expect(await main(['cra', 'watch', '--kev', join(dir, 'kev.json'), '--epss', join(dir, 'epss.csv'), '--became-aware-now'])).toBe(1);
  });

  it('reports a bad --symbols path rather than proceeding blind', async () => {
    await seed();
    expect(await main(['cra', 'watch', '--kev', join(dir, 'kev.json'), '--osv', join(dir, 'osv.json'),
      '--ir', 'll', '--entry', 'main', '--symbols', join(dir, 'absent.json'), '--became-aware-now'])).toBe(1);
  });
});
