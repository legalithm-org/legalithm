import { describe, it, expect, vi, afterEach } from 'vitest';
import { telemetryEnabled, repoHash, emitSurfaceActive } from '../telemetry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telemetryEnabled', () => {
  it('defaults on; off via DO_NOT_TRACK=1 or LEGALITHM_TELEMETRY=0', () => {
    expect(telemetryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(telemetryEnabled({ DO_NOT_TRACK: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(telemetryEnabled({ LEGALITHM_TELEMETRY: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('repoHash', () => {
  it('is 16-hex, stable, path-dependent, and never leaks the path', () => {
    const h = repoHash('/home/me/secret-project');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(repoHash('/home/me/secret-project')).toBe(h);
    expect(repoHash('/other')).not.toBe(h);
    expect(h).not.toContain('secret');
  });
});

describe('emitSurfaceActive', () => {
  it('POSTs a sanitized surface_active body when enabled', () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    emitSurfaceActive('http://x', 'check', '/proj', {} as NodeJS.ProcessEnv);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe('surface_active');
    expect(body.metadata).toMatchObject({ surface: 'cli', command: 'check' });
    expect(body.metadata.repoHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does nothing when telemetry is disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    emitSurfaceActive('http://x', 'init', '/proj', { DO_NOT_TRACK: '1' } as NodeJS.ProcessEnv);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when fetch rejects', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    expect(() => emitSurfaceActive('http://x', 'check', '/proj', {} as NodeJS.ProcessEnv)).not.toThrow();
  });
});
