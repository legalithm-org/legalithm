/**
 * A local, append-only record of security-relevant activity.
 *
 * Annex I Part I (2)(l) asks the manufacturer to "provide security related
 * information by recording and monitoring relevant internal activity, including
 * the access to or modification of data, services or functions, with an opt-out
 * mechanism for the user". (2)(d) separately asks the product to "report on
 * possible unauthorised access". One log answers both: (2)(l) is what is
 * recorded, (2)(d) is the failed-authentication entries within it.
 *
 * Three decisions worth stating, because each could reasonably have gone the
 * other way:
 *
 * 1. **It never leaves the machine.** This is a log, not telemetry. Nothing is
 *    transmitted, which is why `DO_NOT_TRACK` does NOT disable it: that variable
 *    is a request not to be tracked by someone else, and there is no someone
 *    else here. `LEGALITHM_SECURITY_LOG=0` is the opt-out the requirement asks
 *    for, and it is named for what it turns off.
 *
 * 2. **Writing to it can never break a command.** A compliance tool that fails
 *    a build because it could not write its own audit line has made the log more
 *    important than the work. Every failure here is swallowed.
 *
 * 3. **It is bounded.** An append-only file that nothing trims becomes a disk
 *    problem years later, on a machine nobody is watching.
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export type SecurityEvent =
  /** A credential was written to disk. Modification of data. */
  | 'credentials_written'
  /** A credential was removed. Modification of data. */
  | 'credentials_removed'
  /** The API rejected the key. Possible unauthorised access: (2)(d). */
  | 'auth_failed'
  /** The product was reset to its original state: (2)(b). */
  | 'reset'
  /** Data and settings were exported for transfer: (2)(m). */
  | 'data_exported'
  /** Data and settings were permanently removed: (2)(m). */
  | 'data_deleted';

export interface SecurityRecord {
  at: string;
  event: SecurityEvent;
  detail?: string;
}

/** Same spellings telemetry accepts, for the same reason: a host UI may send "false". */
const OFF = new Set(['0', 'false', 'no', 'off']);

/** Trim to this many lines once the file exceeds MAX_LINES. */
const KEEP_LINES = 500;
const MAX_LINES = 1000;

export function securityLogPath(home: string = homedir()): string {
  return join(home, '.config', 'legalithm', 'security.log');
}

/**
 * On by default, which is what "with an opt-out mechanism for the user" implies:
 * a log you have to switch on is not one the user opts out of.
 */
export function securityLogEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  const flag = env.LEGALITHM_SECURITY_LOG?.trim().toLowerCase();
  return !(flag !== undefined && OFF.has(flag));
}

export function recordSecurityEvent(
  event: SecurityEvent,
  detail?: string,
  opts: { path?: string; env?: Partial<NodeJS.ProcessEnv>; now?: () => string } = {},
): void {
  if (!securityLogEnabled(opts.env ?? process.env)) return;

  /*
   * Never write to the REAL log from a test run.
   *
   * This is a backstop, and it exists because the backstop was missing. Every
   * caller that did not inject a path wrote to ~/.config/legalithm/security.log
   * during `vitest`, and by the time it was noticed the author's own log held
   * 448 fabricated "a credential was written" entries and 56 fabricated "your
   * key was rejected" ones. One real entry, 504 invented.
   *
   * For this feature specifically that is worse than a crash. The log exists so
   * a person can answer "has anything odd happened on this machine", and a log
   * full of invented failed authentications answers it with yes.
   *
   * A test that genuinely wants to exercise logging injects `path`, and that
   * still works. What cannot happen any more is a test reaching the default.
   */
  if (!opts.path && process.env.VITEST) return;

  const path = opts.path ?? securityLogPath();
  const line = `${JSON.stringify({
    at: opts.now ? opts.now() : new Date().toISOString(),
    event,
    ...(detail ? { detail } : {}),
  })}\n`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, '', { encoding: 'utf8', mode: 0o600 });
    appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 });
    trim(path);
  } catch {
    /* see decision 2 above */
  }
}

function trim(path: string): void {
  try {
    // Cheap guard: only read the file back when it is big enough to plausibly
    // exceed the cap, so the common case is one append and one stat.
    if (statSync(path).size < MAX_LINES * 64) return;
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_LINES) return;
    writeFileSync(path, `${lines.slice(-KEEP_LINES).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* see decision 2 above */
  }
}

/** Read the log back. Malformed lines are dropped rather than throwing. */
export function readSecurityLog(path: string = securityLogPath()): SecurityRecord[] {
  if (!existsSync(path)) return [];
  const out: SecurityRecord[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SecurityRecord;
      if (parsed && typeof parsed.at === 'string' && typeof parsed.event === 'string') out.push(parsed);
    } catch {
      /* a truncated final line should not hide the entries above it */
    }
  }
  return out;
}
