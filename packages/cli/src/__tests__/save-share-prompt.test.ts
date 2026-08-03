import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shouldPromptSaveShare,
  normalizeSaveShareAnswer,
  maybePromptSaveShare,
  type TtyLike,
} from '../save-share-prompt.js';
import { emitCliSaveShare, flushTelemetry } from '../telemetry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function tty(isTTY: boolean): TtyLike {
  return { isTTY };
}

describe('normalizeSaveShareAnswer', () => {
  it('maps y/yes to y; everything else to n', () => {
    expect(normalizeSaveShareAnswer('y')).toBe('y');
    expect(normalizeSaveShareAnswer('Y')).toBe('y');
    expect(normalizeSaveShareAnswer(' yes ')).toBe('y');
    expect(normalizeSaveShareAnswer('')).toBe('n');
    expect(normalizeSaveShareAnswer('n')).toBe('n');
    expect(normalizeSaveShareAnswer('maybe')).toBe('n');
  });
});

describe('shouldPromptSaveShare', () => {
  const base = {
    apiUrl: 'http://x',
    command: 'init' as const,
    cwd: '/proj',
    noPrompt: false,
    env: {},
    stdin: tty(true),
    stdout: tty(true),
  };

  it('prompts only when TTY, not CI, telemetry on, and no --no-prompt', () => {
    expect(shouldPromptSaveShare(base)).toBe(true);
  });

  it('skips with --no-prompt', () => {
    expect(shouldPromptSaveShare({ ...base, noPrompt: true })).toBe(false);
  });

  it('skips in CI', () => {
    expect(shouldPromptSaveShare({ ...base, env: { CI: 'true' } })).toBe(false);
    expect(shouldPromptSaveShare({ ...base, env: { CI: '1' } })).toBe(false);
  });

  it('skips when DO_NOT_TRACK / LEGALITHM_TELEMETRY=0', () => {
    expect(shouldPromptSaveShare({ ...base, env: { DO_NOT_TRACK: '1' } })).toBe(false);
    expect(shouldPromptSaveShare({ ...base, env: { LEGALITHM_TELEMETRY: '0' } })).toBe(false);
  });

  it('skips when stdout or stdin is not a TTY', () => {
    expect(shouldPromptSaveShare({ ...base, stdout: tty(false) })).toBe(false);
    expect(shouldPromptSaveShare({ ...base, stdin: tty(false) })).toBe(false);
  });
});

describe('maybePromptSaveShare', () => {
  it('asks once, emits cli_save_share with the answer, and returns y|n', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const answer = await maybePromptSaveShare({
      apiUrl: 'http://x',
      command: 'check',
      cwd: '/proj',
      noPrompt: false,
      env: {},
      stdin: tty(true),
      stdout: tty(true),
      ask: async () => 'y',
    });
    expect(answer).toBe('y');
    await flushTelemetry();
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
      event: 'cli_save_share',
      metadata: {
        surface: 'cli',
        command: 'check',
        answer: 'y',
        repoHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    });
  });

  it('CI-simulated run: no prompt, no emit', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ask = vi.fn(async () => 'y');
    const answer = await maybePromptSaveShare({
      apiUrl: 'http://x',
      command: 'init',
      cwd: '/proj',
      noPrompt: false,
      env: { CI: 'true' },
      stdin: tty(true),
      stdout: tty(true),
      ask,
    });
    expect(answer).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('emitCliSaveShare', () => {
  it('does nothing when telemetry is disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    emitCliSaveShare('http://x', 'init', '/proj', 'y', { DO_NOT_TRACK: '1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
