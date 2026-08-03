import { describe, it, expect, vi, afterEach } from 'vitest';
import { telemetryEnabled, repoHash, emitSurfaceActive } from '../telemetry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mcp telemetryEnabled', () => {
  it('defaults on; off via DO_NOT_TRACK=1 or LEGALITHM_TELEMETRY=0', () => {
    expect(telemetryEnabled({})).toBe(true);
    expect(telemetryEnabled({ DO_NOT_TRACK: '1' })).toBe(false);
    expect(telemetryEnabled({ LEGALITHM_TELEMETRY: '0' })).toBe(false);
  });
});

describe('mcp repoHash', () => {
  it('is 16-hex and stable', () => {
    const h = repoHash('/tmp/mcp-proj');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(repoHash('/tmp/mcp-proj')).toBe(h);
  });
});

describe('mcp emitSurfaceActive', () => {
  it('POSTs surface: mcp with the tool name as command', () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    emitSurfaceActive('http://x', 'classify', '/proj', {});
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
    expect(body).toEqual({
      event: 'surface_active',
      metadata: {
        surface: 'mcp',
        command: 'classify',
        repoHash: repoHash('/proj'),
      },
    });
  });

  it('does nothing when DO_NOT_TRACK=1', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    emitSurfaceActive('http://x', 'classify', '/proj', { DO_NOT_TRACK: '1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when fetch rejects', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    expect(() => emitSurfaceActive('http://x', 'check_record', '/proj', {})).not.toThrow();
  });
});
