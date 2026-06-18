// `legalithm guard` — the fast, OFFLINE enforcement primitive that Claude Code
// hooks and pre-commit call. No API call, no key, no network: "does this repo use
// AI, and is there a compliance record?" The full law-drift check is the
// API-backed `legalithm check` (Stop hook / CI).
//
// Output modes:
//   (plain)            human message; exit 0 / 2 (CI, pre-commit, manual)
//   --hook stop        emit Claude Code Stop-block JSON when blocking (exit 0)
//   --hook posttooluse emit PostToolUse additionalContext JSON (never blocks)
//
// NOTE on Stop: Claude Code blocks a Stop via JSON decision on stdout, NOT via
// exit code — so the hook modes emit JSON. (`exit 2` alone does not block Stop.)

import type { StackDetectionResult } from '../types.js';

export type GuardStatus = 'no-ai' | 'ok' | 'missing-record';
export type HookMode = 'stop' | 'posttooluse';

export interface GuardEvaluation {
  status: GuardStatus;
  exitCode: number;
  message: string;
}

export interface GuardInput {
  usesGenAI: boolean;
  recordExists: boolean;
  warnOnly?: boolean;
}

const INIT_HINT =
  'Run `npx legalithm init` to generate an EU AI Act compliance record (compliance/legalithm.json).';

/** Pure decision — the heart of the guard, unit-tested in isolation. */
export function evaluateGuard(input: GuardInput): GuardEvaluation {
  if (!input.usesGenAI) {
    return { status: 'no-ai', exitCode: 0, message: 'Legalithm: no AI dependencies detected — nothing to check.' };
  }
  if (input.recordExists) {
    return { status: 'ok', exitCode: 0, message: 'Legalithm: AI detected and a compliance record is present.' };
  }
  const message = `⚠ Legalithm: AI dependencies detected but no compliance record found. ${INIT_HINT}`;
  return { status: 'missing-record', exitCode: input.warnOnly ? 0 : 2, message };
}

/**
 * Format the evaluation for a Claude Code hook. Returns the stdout string (or null
 * for "no output") and the exit code.
 * - stop: block the agent from finishing when a record is missing (JSON decision).
 * - posttooluse: surface a non-blocking nudge the model sees next turn.
 */
export function formatHookOutput(result: GuardEvaluation, mode: HookMode): { stdout: string | null; exitCode: number } {
  if (result.status !== 'missing-record') {
    return { stdout: null, exitCode: 0 }; // ok / no-ai → say nothing, let the agent proceed
  }
  if (mode === 'stop') {
    // Claude Code's Stop-hook schema is the top-level { decision, reason } form.
    // (Adding hookSpecificOutput here fails strict schema validation → the block
    // is dropped — verified live against Claude Code 2.1.150.) Exit 0; the JSON blocks.
    // The reason is framed as owner-set project policy (not an imperative command)
    // because agents flag a hook that tells them to run a command as a possible
    // prompt-injection and refuse it.
    const reason =
      'Project policy (configured by this repository\'s owner via Legalithm): this repo ships ' +
      'an AI feature to EU users, but there is no EU AI Act compliance record at ' +
      'compliance/legalithm.json. Create it with `legalithm init`, or remove the AI dependency, ' +
      'before completing. If unsure, ask the user — this is the project\'s own configured gate.';
    return { stdout: JSON.stringify({ decision: 'block', reason }), exitCode: 0 };
  }
  // posttooluse — non-blocking; the model sees additionalContext on its next turn.
  const payload = {
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: result.message },
  };
  return { stdout: JSON.stringify(payload), exitCode: 0 };
}

export interface RunGuardDeps {
  detect: () => StackDetectionResult;
  recordExists: () => boolean;
  log: (m: string) => void;
}

export interface RunGuardOptions {
  warnOnly?: boolean;
  json?: boolean;
  hook?: HookMode;
  /** Claude Code's stop_hook_active flag: true when this Stop is already a
   *  continuation of a prior Stop-hook block. We block ONCE to surface the gap,
   *  then allow the stop (the CI Action is the hard gate) — otherwise a model
   *  that can't/won't resolve loops until it gives up. */
  stopHookActive?: boolean;
}

/** I/O wrapper: detect the stack + look for the record, then evaluate + format. */
export function runGuard(deps: RunGuardDeps, opts: RunGuardOptions = {}): number {
  const detection = deps.detect();
  const result = evaluateGuard({
    usesGenAI: detection.inferred.usesGenAI,
    recordExists: deps.recordExists(),
    warnOnly: opts.warnOnly,
  });

  if (opts.hook) {
    // Already blocked once this stop-sequence → don't re-block (avoid the loop).
    if (opts.hook === 'stop' && opts.stopHookActive) return 0;
    const { stdout, exitCode } = formatHookOutput(result, opts.hook);
    if (stdout) deps.log(stdout);
    return exitCode;
  }

  if (opts.json) {
    deps.log(JSON.stringify({ status: result.status, message: result.message }));
  } else if (result.status !== 'no-ai') {
    deps.log(result.message);
  }
  return result.exitCode;
}
