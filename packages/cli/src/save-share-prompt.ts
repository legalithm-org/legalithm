import * as readline from 'readline';

import { emitCliSaveShare, telemetryEnabled } from './telemetry.js';

export type SaveShareCommand = 'init' | 'check';

/** Only `isTTY` is consulted for the interactive gate. */
export type TtyLike = { isTTY?: boolean };

export interface SaveSharePromptDeps {
  apiUrl: string;
  command: SaveShareCommand;
  cwd: string;
  /** `--no-prompt` escape hatch. */
  noPrompt: boolean;
  env?: Partial<NodeJS.ProcessEnv>;
  stdin?: TtyLike;
  stdout?: TtyLike;
  /** Injected for tests — default asks on process.stdin/stdout. */
  ask?: (question: string) => Promise<string>;
}

/**
 * P1 probe: after a successful init/check, ask once whether the user wants to
 * save or share the record. Answer is telemetered for the 25 Oct y-rate gate.
 * Never prompts when non-TTY, CI, DO_NOT_TRACK / telemetry off, or --no-prompt.
 */
export function shouldPromptSaveShare(deps: SaveSharePromptDeps): boolean {
  const env = deps.env ?? process.env;
  if (deps.noPrompt) return false;
  if (!telemetryEnabled(env)) return false;
  if (env.CI === 'true' || env.CI === '1') return false;
  const stdout = deps.stdout ?? process.stdout;
  const stdin = deps.stdin ?? process.stdin;
  if (!stdout.isTTY || !stdin.isTTY) return false;
  return true;
}

function defaultAsk(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Normalize free-text to y | n. Empty / anything else → n (default). */
export function normalizeSaveShareAnswer(raw: string): 'y' | 'n' {
  const t = raw.trim().toLowerCase();
  if (t === 'y' || t === 'yes') return 'y';
  return 'n';
}

/**
 * Prompt once when allowed; emit `cli_save_share` with the answer.
 * Returns the answer when a prompt ran, otherwise null.
 */
export async function maybePromptSaveShare(deps: SaveSharePromptDeps): Promise<'y' | 'n' | null> {
  if (!shouldPromptSaveShare(deps)) return null;

  const ask = deps.ask ?? defaultAsk;
  const raw = await ask('Save or share this record? [y/N] ');
  const answer = normalizeSaveShareAnswer(raw);

  emitCliSaveShare(deps.apiUrl, deps.command, deps.cwd, answer, deps.env);
  return answer;
}
