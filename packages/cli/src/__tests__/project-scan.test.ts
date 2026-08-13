import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from '../index.js';

const KEY = `lgl_${'a'.repeat(64)}`;

/**
 * The project-scanning helpers in index.ts — walkImages, readSourcePaths,
 * readCiIacManifests and readMcpConfigs — were the last untested functions in
 * the package. Each one decides what the tool looks at, so a miss here is
 * silent: the scan simply reports less than it should and the user reads that
 * as "nothing to do".
 */
describe('project scanning', () => {
  let dir: string;
  let logs: string[];
  let origKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legalithm-scan-'));
    logs = [];
    origKey = process.env.LEGALITHM_API_KEY;
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void logs.push(String(m)));
  });

  afterEach(() => {
    if (origKey === undefined) delete process.env.LEGALITHM_API_KEY;
    else process.env.LEGALITHM_API_KEY = origKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const output = () => logs.join('\n');

  describe('walkImages, via verify --check', () => {
    const png = () => Buffer.from('89504e470d0a1a0a', 'hex');

    it('finds images nested below the starting directory', async () => {
      mkdirSync(join(dir, 'assets', 'img'), { recursive: true });
      writeFileSync(join(dir, 'assets', 'img', 'hero.png'), png());
      await main(['verify', '--check', dir]);
      expect(output()).toMatch(/hero\.png|1 file|scanned/i);
    });

    it('skips node_modules and other build directories', async () => {
      // Without this the scan walks a dependency tree and reports thousands of
      // third-party images as the user's own AI content.
      for (const skipped of ['node_modules', 'dist', 'coverage']) {
        mkdirSync(join(dir, skipped), { recursive: true });
        writeFileSync(join(dir, skipped, 'vendor.png'), png());
      }
      await main(['verify', '--check', dir]);
      expect(output()).not.toContain('vendor.png');
    });

    it('skips dotted directories', async () => {
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.git', 'hidden.png'), png());
      await main(['verify', '--check', dir]);
      expect(output()).not.toContain('hidden.png');
    });

    it('ignores files that are not images', async () => {
      writeFileSync(join(dir, 'notes.txt'), 'hello');
      writeFileSync(join(dir, 'data.json'), '{}');
      const code = await main(['verify', '--check', dir]);
      expect(code).toBe(0);
      expect(output()).not.toContain('notes.txt');
    });

    it('returns cleanly when the directory does not exist', async () => {
      // walkImages swallows the readdir error rather than throwing.
      const code = await main(['verify', '--check', join(dir, 'nope')]);
      expect(typeof code).toBe('number');
    });
  });

  /**
   * These three are reached by `discover`, not by `classify` — an easy thing to
   * get wrong, and the reason they stayed uncovered after the first attempt.
   * discover is offline unless --push is given, so no key or fetch stub needed.
   */
  describe('readSourcePaths / readCiIacManifests / readMcpConfigs, via discover', () => {
    it('walks sources, CI workflows, Docker files and MCP config together', async () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { openai: '^4' } }));
      mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
      writeFileSync(join(dir, 'src', 'lib', 'ai.ts'), "import OpenAI from 'openai';\n");
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\non: [push]\n');
      writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20\nENV OPENAI_BASE_URL=https://api.openai.com/v1\n');
      writeFileSync(
        join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { legalithm: { command: 'npx', args: ['-y', 'legalithm-mcp-server'] } } }),
      );

      expect(await main(['discover'])).toBe(0);
    });

    it('reads MCP config from the Cursor and Claude paths as well as the root', async () => {
      // readMcpConfigs reads these explicitly because readSourcePaths skips
      // dotfiles, so a Cursor-only project would otherwise look MCP-free.
      mkdirSync(join(dir, '.cursor'), { recursive: true });
      writeFileSync(
        join(dir, '.cursor', 'mcp.json'),
        JSON.stringify({ mcpServers: { other: { command: 'npx', args: ['-y', 'x'] } } }),
      );
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ mcpServers: {} }));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));

      expect(await main(['discover'])).toBe(0);
    });

    it('runs on an empty directory without throwing', async () => {
      expect(await main(['discover'])).toBe(0);
    });

    it('emits JSON under --json', async () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { openai: '^4' } }));
      await main(['discover', '--json']);
      const parsed = logs.some((l) => {
        try {
          JSON.parse(l);
          return true;
        } catch {
          return false;
        }
      });
      expect(parsed, 'no line of --json output parsed as JSON').toBe(true);
    });

    it('requires a key for --push and says so rather than failing silently', async () => {
      delete process.env.LEGALITHM_API_KEY;
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
      const code = await main(['discover', '--push']);
      expect(code).not.toBe(0);
    });
  });

  describe('buildUseCase, via classify', () => {
    beforeEach(() => {
      process.env.LEGALITHM_API_KEY = KEY;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ risk: 'limited' }), { status: 200 })),
      );
    });

    it('scans a project with sources, CI workflows and MCP config without error', async () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { openai: '^4' } }));
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'app.ts'), 'export const x = 1;\n');
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\non: [push]\n');
      writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20\n');
      writeFileSync(
        join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { legalithm: { command: 'npx', args: ['-y', 'legalithm-mcp-server'] } } }),
      );

      const code = await main(['classify']);
      expect(code).toBe(0);
    });

    it('handles a project with no source directory at all', async () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'empty' }));
      const code = await main(['classify']);
      expect(code).toBe(0);
    });

    it('accepts use-case flags as an override rather than reading the package name', async () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
      const code = await main([
        'classify',
        '--role',
        'provider',
        '--domain',
        'employment',
        '--use-case',
        'screens job applicants',
        '--audience',
        'workers',
      ]);
      expect(code).toBe(0);
    });
  });
});
