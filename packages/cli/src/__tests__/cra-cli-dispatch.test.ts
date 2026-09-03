import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../index.js';

/**
 * The router, driven the way a user drives it: through argv.
 *
 * Everything else tests the command functions directly, which skips the layer
 * that turns `--third-party` into `thirdParty` and decides which command runs.
 * A flag that never reaches its command is invisible to those tests and total
 * to the person typing it. That happened tonight: `cra watch` grew --ir,
 * --entry and --symbols while index.ts forwarded only kev, product and json,
 * so reachability silently never ran.
 */
let dir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
const logged: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-cli-'));
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

describe('cra subcommand routing', () => {
  it('prints usage naming every subcommand for an unknown one', async () => {
    expect(await main(['cra', 'nonsense'])).toBe(1);
    for (const sub of ['classify', 'product', 'ingest', 'watch', 'claim', 'report', 'record']) {
      expect(said(), `usage should name ${sub}`).toContain(sub);
    }
  });

  it('prints usage with no subcommand at all', async () => {
    expect(await main(['cra'])).toBe(1);
  });

  it('routes classify and cites the Regulation', async () => {
    expect(await main(['cra', 'classify', '--kind', 'software', '--connected', '--commercial'])).toBe(0);
    expect(said()).toContain('Article');
  });

  it('routes product and registers it', async () => {
    expect(await main(['cra', 'product', '--name', 'Acme', '--version', '2.4.0'])).toBe(0);
    expect(said()).toContain('Registered Acme 2.4.0');
  });
});

describe('flags actually reach their command', () => {
  it('forwards --third-party and --manufacturer', async () => {
    await main(['cra', 'product', '--name', 'curl', '--version', '8.11.1',
      '--third-party', '--manufacturer', 'the curl project']);
    expect(said()).toContain('ANALYSIS ONLY');
    expect(said()).toContain('the curl project');
  });

  it('refuses --third-party without --manufacturer, through the router', async () => {
    expect(await main(['cra', 'product', '--name', 'x', '--version', '1', '--third-party'])).toBe(1);
    expect(said()).toContain('attributable to nobody');
  });

  it('forwards --class through to classification', async () => {
    await main(['cra', 'product', '--name', 'Gate', '--version', '1', '--class', 'important_class_ii']);
    expect(said()).toContain('important_class_ii');
  });

  it('rejects an unknown --class rather than silently defaulting', async () => {
    expect(await main(['cra', 'product', '--name', 'x', '--version', '1', '--class', 'made_up'])).toBe(1);
  });

  it('forwards --json and emits parseable output', async () => {
    await main(['cra', 'classify', '--kind', 'software', '--connected', '--commercial', '--json']);
    expect(() => JSON.parse(said())).not.toThrow();
  });

  it('forwards the Article 14 stage and refuses an unknown one', async () => {
    expect(await main(['cra', 'report', '--cve', 'CVE-1', '--stage', 'someday'])).toBe(1);
    expect(said()).toContain('Unknown --stage');
  });

  it('forwards --incident to select the severe-incident track', async () => {
    await main(['cra', 'product', '--name', 'Acme', '--version', '1']);
    logged.length = 0;
    await main(['cra', 'report', '--incident', '--cve', 'INC-1', '--stage', 'early-warning']);
    expect(said()).toContain('Article 14(4)(a)');
  });

  it('forwards --member-states as a list', async () => {
    await main(['cra', 'product', '--name', 'Acme', '--version', '1']);
    logged.length = 0;
    await main(['cra', 'report', '--incident', '--cve', 'INC-1', '--stage', 'early-warning',
      '--member-states', 'DE,FR']);
    expect(said()).not.toContain('Member States');
  });

  it('forwards --suspected-malicious and its negation distinctly', async () => {
    await main(['cra', 'product', '--name', 'Acme', '--version', '1']);
    for (const [flag, expected] of [['--suspected-malicious', 3], ['--not-suspected-malicious', 3]] as const) {
      logged.length = 0;
      const code = await main(['cra', 'report', '--incident', '--cve', 'INC-1', '--stage', 'early-warning', flag]);
      // Both are answers; neither leaves the unlawful-acts field as a gap.
      expect(code).toBe(expected);
    }
  });
});

describe('ingest and watch through the router', () => {
  const sbom = () => {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] }));
    return p;
  };

  it('resolves --product by NAME, which is what a person types', async () => {
    await main(['cra', 'product', '--name', 'Acme Gateway', '--version', '2.4.0']);
    logged.length = 0;
    expect(await main(['cra', 'ingest', '--sbom', sbom(), '--product', 'Acme Gateway'])).toBe(0);
    expect(said()).toContain('Acme Gateway 2.4.0');
  });

  it('refuses watch with no component-to-CVE source', async () => {
    await main(['cra', 'product', '--name', 'Acme', '--version', '1']);
    await main(['cra', 'ingest', '--sbom', sbom()]);
    logged.length = 0;
    const kev = join(dir, 'kev.json');
    writeFileSync(kev, JSON.stringify({ vulnerabilities: [] }));
    expect(await main(['cra', 'watch', '--kev', kev])).toBe(1);
    expect(said()).toContain('nothing to check KEV against');
  });
});
