import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from '../index.js';

/**
 * The manifest readers behind `guard` — readPackageJson, readManifests and the
 * .csproj scan — were untested. `guard` is the command wired into Claude Code's
 * hooks by `setup`, so it runs on every edit in a project that ran setup: it is
 * the most frequently executed code in the package and had the least coverage.
 *
 * A false negative here is the expensive direction. If guard fails to see an AI
 * dependency, the user is told nothing and believes they have no obligation.
 */
describe('legalithm guard — stack discovery', () => {
  let dir: string;
  let logs: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legalithm-guard-'));
    logs = [];
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const output = () => logs.join('\n');
  /**
   * guard reports that AI dependencies were found; it does not name them. The
   * contract under test is the detection, not the wording, so assert on the
   * warning firing rather than on a package name appearing in stdout.
   */
  const flagged = () => /ai dependencies detected/i.test(output());

  it('detects an AI dependency declared in package.json', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { openai: '^4.0.0' } }),
    );
    await main(['guard', '--warn']);
    expect(flagged()).toBe(true);
  });

  it('reads devDependencies too, not only dependencies', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', devDependencies: { '@anthropic-ai/sdk': '^0.30.0' } }),
    );
    await main(['guard', '--warn']);
    expect(flagged(), 'devDependencies must be scanned as well').toBe(true);
  });

  it('survives a malformed package.json rather than crashing the hook', async () => {
    // This runs on every edit in a project that ran setup. A parse error must
    // not take down the user's editing loop.
    writeFileSync(join(dir, 'package.json'), '{ "name": "app", }');
    const code = await main(['guard', '--warn']);
    expect(code).toBe(0);
  });

  it('reads a Python requirements.txt', async () => {
    writeFileSync(join(dir, 'requirements.txt'), 'openai==1.40.0\nrequests==2.32.0\n');
    await main(['guard', '--warn']);
    expect(flagged(), 'a Python-only project must still be detected').toBe(true);
  });

  /**
   * .NET project files have arbitrary names, so readManifests scans the top
   * level for *.csproj rather than looking for a fixed filename. That scan is a
   * separate branch from the fixed-manifest loop.
   */
  it('finds an arbitrarily named .csproj at the top level', async () => {
    writeFileSync(
      join(dir, 'MyCompany.Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Azure.AI.OpenAI" Version="2.0.0" /></ItemGroup></Project>',
    );
    const code = await main(['guard', '--warn']);
    expect(code).toBe(0);
    expect(flagged(), 'the top-level *.csproj scan is a separate branch').toBe(true);
  });

  it('reports no findings for a project with no AI dependencies', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { lodash: '^4.17.21' } }),
    );
    const code = await main(['guard', '--warn']);
    expect(code).toBe(0);
    expect(flagged(), 'lodash is not an AI dependency').toBe(false);
  });

  it('emits machine-readable output under --json', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { openai: '^4.0.0' } }),
    );
    await main(['guard', '--json', '--warn']);
    const parsed = logs.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    });
    expect(parsed.some((p) => p !== null), 'no line of --json output parsed as JSON').toBe(true);
  });

  it('treats an empty directory as no findings rather than an error', async () => {
    expect(await main(['guard', '--warn'])).toBe(0);
  });

  it('does not mistake a nested manifest for a top-level one', async () => {
    // readManifests is deliberately shallow. A dependency buried in a fixture
    // directory is not this project's dependency.
    mkdirSync(join(dir, 'fixtures', 'sample'), { recursive: true });
    writeFileSync(
      join(dir, 'fixtures', 'sample', 'package.json'),
      JSON.stringify({ dependencies: { openai: '^4.0.0' } }),
    );
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
    await main(['guard', '--warn']);
    expect(flagged(), 'readManifests is deliberately shallow').toBe(false);
  });
});
