/**
 * Annex I Part I (2)(c): "the notification of available updates".
 *
 * The version number arrives on responses the CLI was already making, and is
 * cached locally so the notice survives into commands that never touch the
 * network. That second half matters more than it looks: most of this product's
 * surface (`setup`, `guard`, every `cra` subcommand) is offline by design, so a
 * notice that only appeared during authenticated calls would reach almost
 * nobody. After one authenticated command, every later run can notify.
 *
 * What this still does not do, stated plainly because the determination depends
 * on it: a user who NEVER runs an authenticated command is never notified. That
 * is the accepted cost of not adding a fifth outbound endpoint to a tool whose
 * position is that your dependency list does not leave the machine.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface UpdateCache {
  latestVersion: string;
  seenAt: string;
}

/** Numeric triple compare. A prerelease sorts below the release of same triple. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
    if (!m) return null;
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.nums[i]! > b.nums[i]!) return true;
    if (a.nums[i]! < b.nums[i]!) return false;
  }
  // Same triple: a release is newer than a prerelease of it, never the reverse.
  return a.pre === null && b.pre !== null;
}

export function readUpdateCache(path: string): UpdateCache | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as UpdateCache;
    return typeof parsed?.latestVersion === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort: never let a cache write break the command that triggered it. */
export function writeUpdateCache(path: string, latestVersion: string, now = new Date().toISOString()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ latestVersion, seenAt: now }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    /* a missed notification is not worth a failed command */
  }
}

/**
 * The notice itself, or null when there is nothing to say.
 *
 * It names the security framing rather than the marketing one: this exists so a
 * vulnerability can be addressed, and the sentence should say that.
 */
export function updateNotice(latest: string | null, current: string): string[] | null {
  if (!latest || !isNewer(latest, current)) return null;
  return [
    '',
    `A newer Legalithm CLI is available: ${current} → ${latest}`,
    '  Updates are how vulnerabilities in this tool reach you.  npm i -g legalithm@latest',
    '  Silence this:  LEGALITHM_NO_UPDATE_NOTICE=1',
  ];
}

const OFF = new Set(['1', 'true', 'yes', 'on']);
export function updateNoticeEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  const flag = env.LEGALITHM_NO_UPDATE_NOTICE?.trim().toLowerCase();
  return !(flag !== undefined && OFF.has(flag));
}
