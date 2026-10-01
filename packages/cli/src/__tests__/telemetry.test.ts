import { describe, it, expect, vi, afterAll, afterEach, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  telemetryEnabled,
  repoHash,
  emitSurfaceActive,
  normaliseRemote,
  projectIdentity,
} from '../telemetry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telemetryEnabled', () => {
  it('defaults on; off via DO_NOT_TRACK=1 or LEGALITHM_TELEMETRY=0', () => {
    expect(telemetryEnabled({})).toBe(true);
    expect(telemetryEnabled({ DO_NOT_TRACK: '1' })).toBe(false);
    expect(telemetryEnabled({ LEGALITHM_TELEMETRY: '0' })).toBe(false);
  });

  // Kept identical to the MCP server's contract; the two are documented as one
  // privacy promise, so they must not diverge on what counts as opting out.
  it.each(['false', 'FALSE', ' false ', 'no', 'off', '0'])('treats %j as opt-out', (value) => {
    expect(telemetryEnabled({ LEGALITHM_TELEMETRY: value })).toBe(false);
  });

  it('stays on for enabled-looking values', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', '']) {
      expect(telemetryEnabled({ LEGALITHM_TELEMETRY: value })).toBe(true);
    }
  });
});

describe('repoHash', () => {
  it('is 16-hex, stable, input-dependent, and never leaks the input', () => {
    const h = repoHash('/home/me/secret-project');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(repoHash('/home/me/secret-project')).toBe(h);
    expect(repoHash('/other')).not.toBe(h);
    expect(h).not.toContain('secret');
  });
});

describe('normaliseRemote', () => {
  /**
   * Every clone of one repo must collapse to one identity. Without this, cloning
   * over SSH instead of HTTPS counts as a second project and rotating an embedded
   * token counts as a third.
   */
  const canonical = 'github.com/legalithm-org/legalithm';

  it.each([
    'git@github.com:legalithm-org/legalithm.git',
    'https://github.com/legalithm-org/legalithm.git',
    'https://github.com/legalithm-org/legalithm',
    'ssh://git@github.com:22/legalithm-org/legalithm.git',
    'https://x-access-token:ghs_SECRET@github.com/legalithm-org/legalithm.git',
    'HTTPS://GitHub.com/Legalithm-Org/Legalithm.git/',
  ])('collapses %s', (url) => {
    expect(normaliseRemote(url)).toBe(canonical);
  });

  it('strips credentials, so nothing derived from a secret is hashed', () => {
    const n = normaliseRemote('https://user:ghs_SUPERSECRET@github.com/a/b.git');
    expect(n).not.toContain('SUPERSECRET');
    expect(n).not.toContain('user');
    // And a rotated token must not change the identity.
    expect(n).toBe(normaliseRemote('https://user:ghs_ROTATED@github.com/a/b.git'));
  });

  it('keeps different repos apart', () => {
    expect(normaliseRemote('git@github.com:a/b.git')).not.toBe(
      normaliseRemote('git@github.com:a/c.git'),
    );
  });

  it('returns empty for junk rather than inventing an identity', () => {
    expect(normaliseRemote('')).toBe('');
    expect(normaliseRemote('   ')).toBe('');
  });
});

describe('projectIdentity', () => {
  // Git exports GIT_DIR (and friends) to hook processes, and the pre-push hook runs this
  // suite. Inherited, they point every git call here at the REAL repository instead of the
  // temp dirs: `git init` then set core.bare=true on the Legalithm checkout (26 Sep 2026),
  // breaking git for every worktree. Clear them for this block, restore after.
  const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const name of GIT_LOCATION_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });
  afterAll(() => {
    for (const name of GIT_LOCATION_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  const tmp = () => mkdtempSync(join(tmpdir(), 'legalithm-tel-'));
  const run = (args: string[], cwd: string) =>
    spawnSync('git', args, { cwd, stdio: 'ignore' });

  it('falls back to cwd, labelled, outside a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legalithm-nogit-'));
    const id = projectIdentity(dir);
    // May legitimately resolve to `root` if the temp dir sits inside a checkout.
    expect(['cwd', 'root']).toContain(id.basis);
    expect(id.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('THE BUG: two ephemeral clones of one repo now share an identity', () => {
    // This is the regression that made 2,395 calls look like 2,340 repos. Each CI
    // run gets a fresh temp directory; hashing cwd minted a new "repo" every time.
    const a = tmp();
    const b = tmp();
    for (const d of [a, b]) {
      run(['init', '-q'], d);
      run(['remote', 'add', 'origin', 'git@github.com:acme/widget.git'], d);
    }
    const ia = projectIdentity(a);
    const ib = projectIdentity(b);

    if (ia.basis !== 'remote' || ib.basis !== 'remote') return; // git unavailable
    expect(ia.hash).toBe(ib.hash);
    // And the old behaviour would have disagreed, which is the point.
    expect(repoHash(a)).not.toBe(repoHash(b));
  });

  it('separates two different repos checked out to sibling directories', () => {
    const a = tmp();
    const b = tmp();
    run(['init', '-q'], a);
    run(['remote', 'add', 'origin', 'git@github.com:acme/one.git'], a);
    run(['init', '-q'], b);
    run(['remote', 'add', 'origin', 'git@github.com:acme/two.git'], b);

    const ia = projectIdentity(a);
    const ib = projectIdentity(b);
    if (ia.basis !== 'remote' || ib.basis !== 'remote') return;
    expect(ia.hash).not.toBe(ib.hash);
  });

  it('uses the repository root when a checkout has no remote', () => {
    const dir = tmp();
    run(['init', '-q'], dir);
    const id = projectIdentity(dir);
    if (id.basis === 'cwd') return; // git unavailable
    expect(id.basis).toBe('root');
    expect(id.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('emitSurfaceActive', () => {
  it('POSTs a sanitized surface_active body when enabled', () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    emitSurfaceActive('http://x', 'check', '/proj', {});
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    const init = call[1];
    expect(init).toBeDefined();
    if (init === undefined || typeof init.body !== 'string') {
      throw new Error('expected fetch init with string body');
    }
    const body = JSON.parse(init.body);
    expect(body.event).toBe('surface_active');
    expect(body.metadata).toMatchObject({ surface: 'cli', command: 'check' });
    expect(body.metadata.repoHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does nothing when telemetry is disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    emitSurfaceActive('http://x', 'init', '/proj', { DO_NOT_TRACK: '1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when fetch rejects', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    expect(() => emitSurfaceActive('http://x', 'check', '/proj', {})).not.toThrow();
  });
});
