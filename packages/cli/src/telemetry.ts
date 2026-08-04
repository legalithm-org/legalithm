// Anonymous, opt-out usage telemetry. Sends only { surface, command, repoHash } —
// repoHash is a one-way hash of the cwd path (the path never leaves the machine).
import { createHash } from 'crypto';

/**
 * Off for DO_NOT_TRACK=1, or LEGALITHM_TELEMETRY set to 0 / false / no / off.
 *
 * The extra spellings are not cosmetic. MCPB user_config substitutes a boolean
 * into env as the literal string "false", so a host UI toggle that only emitted
 * "false" would have left telemetry running while telling the user it was off.
 * An opt-out that silently fails is worse than no opt-out.
 */
const TELEMETRY_OFF = new Set(['0', 'false', 'no', 'off']);

export function telemetryEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  if (env.DO_NOT_TRACK === '1') return false;
  const flag = env.LEGALITHM_TELEMETRY?.trim().toLowerCase();
  return !(flag !== undefined && TELEMETRY_OFF.has(flag));
}

/** Stable, anonymous per-repo id: sha256(cwd) truncated to 16 hex. */
export function repoHash(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

/** Commands that emit surface_active (must match /^[a-z_-]{1,32}$/ on the backend). */
export const CLI_TELEMETRY_COMMANDS = [
  'setup',
  'guard',
  'mark',
  'verify',
  'verify-record',
  'discover',
  'init',
  'check',
  'login',
] as const;

const pending: Promise<unknown>[] = [];

/** True when a flush would wait on the network. */
export function hasPendingTelemetry(): boolean {
  return pending.length > 0;
}

/**
 * Drain in-flight telemetry before process.exit. No-op (zero wait) when nothing
 * is queued — including when DO_NOT_TRACK / LEGALITHM_TELEMETRY suppressed emit.
 */
export async function flushTelemetry(timeoutMs = 200): Promise<void> {
  if (pending.length === 0) return;
  const batch = Promise.allSettled(pending.splice(0, pending.length));
  await Promise.race([batch, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

function enqueueTrack(apiUrl: string, body: object): void {
  const p = fetch(`${apiUrl}/api/v1/analytics/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(
    () => {},
    () => {},
  );
  pending.push(p);
}

/** Fire-and-forget surface_active ping — never throws, never blocks the command. */
export function emitSurfaceActive(
  apiUrl: string,
  command: string,
  cwd: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void {
  if (!telemetryEnabled(env)) return;
  enqueueTrack(apiUrl, {
    event: 'surface_active',
    metadata: { surface: 'cli', command, repoHash: repoHash(cwd) },
  });
}

/**
 * P1 save/share probe — answer is y|n only (never free text).
 * Queued the same way as surface_active so flushTelemetry drains it.
 */
export function emitCliSaveShare(
  apiUrl: string,
  command: 'init' | 'check',
  cwd: string,
  answer: 'y' | 'n',
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void {
  if (!telemetryEnabled(env)) return;
  enqueueTrack(apiUrl, {
    event: 'cli_save_share',
    metadata: { surface: 'cli', command, answer, repoHash: repoHash(cwd) },
  });
}
