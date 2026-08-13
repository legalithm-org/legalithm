import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const question = vi.fn();
const close = vi.fn();

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: (q: string, cb: (answer: string) => void) => {
      question(q);
      cb('y');
    },
    close,
  })),
}));

import { maybePromptSaveShare } from '../save-share-prompt.js';

/**
 * Every existing test injects `ask`, whose own comment says "injected for tests
 * — default asks on process.stdin/stdout". So the default path, the one that
 * actually runs in front of a user, was the only part never exercised: it opens
 * a readline interface and must close it again.
 *
 * A prompt that fails to close its interface leaves the CLI hanging after
 * `init` — visible to every user, invisible to every test.
 */
describe('save-share prompt — the default readline path', () => {
  beforeEach(() => {
    question.mockClear();
    close.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks on stdin and closes the interface afterwards', async () => {
    await maybePromptSaveShare({
      apiUrl: 'https://www.legalithm.com',
      command: 'init',
      cwd: '/tmp/does-not-matter',
      noPrompt: false,
      env: { LEGALITHM_TELEMETRY: '1' },
      // Both TTY so the interactive gate opens, and no `ask` so the real
      // defaultAsk runs.
      stdin: { isTTY: true },
      stdout: { isTTY: true },
    });

    expect(question, 'the user was never asked').toHaveBeenCalledTimes(1);
    expect(question.mock.calls[0][0]).toMatch(/save or share/i);
    expect(close, 'the readline interface was left open, which hangs the CLI').toHaveBeenCalledTimes(1);
  });

  it('does not open a readline interface when stdout is not a TTY', async () => {
    await maybePromptSaveShare({
      apiUrl: 'https://www.legalithm.com',
      command: 'check',
      cwd: '/tmp/does-not-matter',
      noPrompt: false,
      env: { LEGALITHM_TELEMETRY: '1' },
      stdin: { isTTY: true },
      stdout: { isTTY: false },
    });

    expect(question, 'piped output must never block on a prompt').not.toHaveBeenCalled();
  });

  it('does not prompt under CI even with both streams claiming TTY', async () => {
    await maybePromptSaveShare({
      apiUrl: 'https://www.legalithm.com',
      command: 'init',
      cwd: '/tmp/does-not-matter',
      noPrompt: false,
      env: { CI: 'true', LEGALITHM_TELEMETRY: '1' },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
    });

    expect(question).not.toHaveBeenCalled();
  });
});
