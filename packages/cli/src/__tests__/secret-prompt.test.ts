/**
 * The prompt is the reason `--key` is no longer necessary, so its edge cases
 * are the difference between a safe default and a confusing 401. A fake TTY
 * stands in for the terminal: raw mode is recorded rather than performed.
 */
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import { promptSecret, stdinIsTty } from '../secret-prompt.js';

function fakeTty(isTTY = true) {
  const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (v: boolean) => void; isRaw: boolean };
  const rawCalls: boolean[] = [];
  (input as unknown as { isTTY: boolean }).isTTY = isTTY;
  input.isRaw = false;
  input.setRawMode = (v: boolean) => {
    rawCalls.push(v);
    input.isRaw = v;
  };
  const written: string[] = [];
  const output = { write: (s: string) => written.push(s) } as unknown as NodeJS.WriteStream;
  return { input, output, rawCalls, written };
}

const CTRL_C = String.fromCharCode(3);
const DEL = String.fromCharCode(127);

describe('promptSecret', () => {
  it('returns what was typed, and echoes none of it', async () => {
    const { input, output, written } = fakeTty();
    const p = promptSecret('key: ', { input, output });
    input.write('lgl_secret\n');
    expect(await p).toBe('lgl_secret');
    // Only the prompt and the closing newline: the secret never reaches the
    // terminal, so it is not in scrollback or a screen recording.
    expect(written.join('')).toBe('key: \n');
  });

  it('leaves raw mode on the way out, whatever happened', async () => {
    const { input, output, rawCalls } = fakeTty();
    const p = promptSecret('key: ', { input, output });
    input.write('lgl_x\r');
    await p;
    expect(rawCalls).toEqual([true, false]);
  });

  it('handles a paste that arrives as one chunk', async () => {
    const { input, output } = fakeTty();
    const p = promptSecret('key: ', { input, output });
    input.write(`lgl_${'a'.repeat(64)}\n`);
    expect(await p).toBe(`lgl_${'a'.repeat(64)}`);
  });

  it('applies backspace, because raw mode means nothing else will', async () => {
    const { input, output } = fakeTty();
    const p = promptSecret('key: ', { input, output });
    input.write(`lgl_abX${DEL}c\n`);
    expect(await p).toBe('lgl_abc');
  });

  it('drops control characters instead of storing them in the key', async () => {
    const { input, output } = fakeTty();
    const p = promptSecret('key: ', { input, output });
    // An arrow key in raw mode arrives as an escape sequence. The ESC itself is
    // invisible, so storing it would produce a key that looks correct on screen
    // and fails to authenticate. The printable remainder is left alone: it is
    // visible, so a rejected key is at least explicable.
    input.write(`lgl_a${String.fromCharCode(27)}[Db\n`);
    expect(await p).toBe('lgl_a[Db');
  });

  it('rejects on Ctrl-C rather than returning a partial key', async () => {
    const { input, output, rawCalls } = fakeTty();
    const p = promptSecret('key: ', { input, output });
    input.write(`lgl_par${CTRL_C}`);
    await expect(p).rejects.toThrow('cancelled');
    expect(rawCalls).toEqual([true, false]);
  });

  it('refuses when stdin is not a terminal, so the caller falls back to a pipe', async () => {
    const { input, output } = fakeTty(false);
    await expect(promptSecret('key: ', { input, output })).rejects.toThrow('not a terminal');
  });

  it('stdinIsTty reports the stream, not the environment', () => {
    expect(stdinIsTty(fakeTty(true).input)).toBe(true);
    expect(stdinIsTty(fakeTty(false).input)).toBe(false);
  });
});
