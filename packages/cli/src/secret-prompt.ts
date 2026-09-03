/**
 * Read a secret from the terminal without echoing it.
 *
 * The point is narrow: a secret typed or pasted here goes to the process's
 * stdin, so unlike `--key lgl_...` it is not in argv (readable from the process
 * table) and not written to the shell history file. Echo is suppressed so it
 * also stays out of terminal scrollback and out of any screen recording.
 *
 * Raw mode is what makes suppression possible; it also means this module owns
 * Ctrl-C and backspace for the duration of the prompt, because the terminal's
 * usual line discipline is off while it runs.
 */
import type { ReadStream } from 'tty';

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DELETE = String.fromCharCode(127);
const SPACE = String.fromCharCode(32);

export interface SecretPromptStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

export function stdinIsTty(input: NodeJS.ReadStream = process.stdin): boolean {
  return Boolean(input.isTTY);
}

export function promptSecret(
  prompt: string,
  streams: SecretPromptStreams = { input: process.stdin, output: process.stderr },
): Promise<string> {
  const { input, output } = streams;
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new Error('not a terminal'));
      return;
    }
    // The prompt goes to stderr, not stdout, so `legalithm login` stays usable
    // in a pipeline without the prompt contaminating captured output.
    output.write(prompt);

    let buf = '';
    const tty = input as unknown as ReadStream;
    const wasRaw = tty.isRaw === true;

    const cleanup = () => {
      input.removeListener('data', onData);
      try {
        tty.setRawMode(wasRaw);
      } catch {
        /* not every stream can leave raw mode; nothing useful to do here */
      }
      input.pause();
      output.write('\n');
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === CTRL_D) {
          cleanup();
          resolve(buf);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (ch === DELETE || ch === '\b') {
          buf = buf.slice(0, -1);
          continue;
        }
        // Drop the remaining control characters rather than storing them: an
        // escape sequence from a stray arrow key would otherwise become part of
        // the key and turn a good paste into a confusing 401.
        if (ch >= SPACE) buf += ch;
      }
    };

    try {
      tty.setRawMode(true);
    } catch (e) {
      reject(e as Error);
      return;
    }
    input.resume();
    input.setEncoding('utf8');
    input.on('data', onData);
  });
}
