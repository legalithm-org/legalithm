import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from '../index.js';
import { SETUP_FILES } from '../commands/setup.js';

/**
 * `legalithm setup` is the first command a new user runs, it was the least
 * covered function in the package (index.ts sat at 17.5% functions), and it
 * writes into files the user already owns: .claude/settings.json, .mcp.json,
 * .cursor/mcp.json and CLAUDE.md.
 *
 * The failure that matters is not "setup crashed" — it is "setup silently
 * replaced my Claude Code settings". Most of what follows checks that existing
 * content survives.
 */
describe('legalithm setup', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legalithm-setup-'));
    // process.chdir() throws ERR_WORKER_UNSUPPORTED_OPERATION under vitest
    // workers, and main() reads process.cwd() directly, so stub that instead.
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const readJson = (rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

  it('writes every file in SETUP_FILES and exits 0', async () => {
    expect(await main(['setup'])).toBe(0);
    for (const file of SETUP_FILES) {
      expect(existsSync(join(dir, file.path)), `${file.path} was not written`).toBe(true);
    }
  });

  it('creates nested directories that do not exist yet', async () => {
    await main(['setup']);
    // .cursor/rules/ is two levels deep and absent in a fresh project.
    expect(existsSync(join(dir, '.cursor/rules/legalithm-eu-ai-act.mdc'))).toBe(true);
  });

  it('preserves unrelated keys in an existing .claude/settings.json', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(
      join(dir, '.claude/settings.json'),
      JSON.stringify({ model: 'opus', theme: 'dark', permissions: { allow: ['Bash(ls:*)'] } }, null, 2),
    );

    await main(['setup']);

    const settings = readJson('.claude/settings.json');
    expect(settings.model).toBe('opus');
    expect(settings.theme).toBe('dark');
    expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] });
  });

  it('preserves other MCP servers in an existing .mcp.json', async () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp'] } } }, null, 2),
    );

    await main(['setup']);

    const mcp = readJson('.mcp.json');
    expect(mcp.mcpServers.github).toEqual({ command: 'npx', args: ['-y', 'gh-mcp'] });
    expect(mcp.mcpServers.legalithm).toBeDefined();
  });

  it('survives a corrupt JSON config instead of throwing', async () => {
    // readJsonSafe exists for this; a user with a trailing comma should not see
    // a stack trace from a setup command.
    writeFileSync(join(dir, '.mcp.json'), '{ "mcpServers": { , }');
    expect(await main(['setup'])).toBe(0);
    expect(readJson('.mcp.json').mcpServers).toBeDefined();
  });

  it('appends to an existing CLAUDE.md without discarding its contents', async () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# My project\n\nHouse rules here.\n');
    await main(['setup']);
    const claudeMd = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('# My project');
    expect(claudeMd).toContain('House rules here.');
    expect(claudeMd).toContain('EU AI Act compliance (Legalithm)');
  });

  it('is idempotent: a second run does not duplicate the CLAUDE.md block', async () => {
    await main(['setup']);
    const once = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    await main(['setup']);
    const twice = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');

    expect(twice).toBe(once);
    const marker = 'EU AI Act compliance (Legalithm)';
    expect(twice.split(marker).length - 1).toBe(1);
  });

  it('uses the local bin when the CLI is installed, and says so only when it is not', async () => {
    const logs: string[] = [];
    (console.log as unknown as { mockImplementation: (f: (m: string) => void) => void }).mockImplementation(
      (m: string) => void logs.push(String(m)),
    );

    await main(['setup']);
    const tipWhenAbsent = logs.some((l) => l.includes('zero-latency hooks'));

    logs.length = 0;
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/.bin/legalithm'), '#!/bin/sh\n');
    await main(['setup']);
    const tipWhenPresent = logs.some((l) => l.includes('zero-latency hooks'));

    expect(tipWhenAbsent, 'the npm-install tip should show when the CLI is not local').toBe(true);
    expect(tipWhenPresent, 'the tip is noise once the CLI is already installed').toBe(false);
  });

  it('registers the hook command against the local bin once it exists', async () => {
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/.bin/legalithm'), '#!/bin/sh\n');
    await main(['setup']);
    // `npx legalithm` resolves the local bin; `npx -y legalithm` re-checks the
    // registry on every hook fire, which is the latency this branch avoids.
    expect(JSON.stringify(readJson('.claude/settings.json'))).toContain('npx legalithm');
  });
});
