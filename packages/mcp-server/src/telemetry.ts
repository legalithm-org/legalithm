// Anonymous, opt-out usage telemetry for the MCP server.
// Same privacy contract as packages/cli/src/telemetry.ts: surface + command +
// repoHash only; DO_NOT_TRACK=1 / LEGALITHM_TELEMETRY=0 honoured; fire-and-forget.
import { createHash } from 'crypto';

/**
 * Off for DO_NOT_TRACK=1, or LEGALITHM_TELEMETRY set to 0 / false / no / off.
 *
 * The extra spellings are not cosmetic. The .mcpb manifest exposes telemetry as
 * a user_config boolean, and MCPB substitutes booleans into env as the literal
 * string "false" — so a host UI toggle would have left telemetry running while
 * telling the user it was off. An opt-out that silently fails is worse than no
 * opt-out, on a product that sells trustworthy evidence.
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

/** MCP tool names emitted as command (must match /^[a-z_-]{1,32}$/). */
export const MCP_TELEMETRY_COMMANDS = [
  'classify',
  'explain_obligation',
  'generate_disclosure',
  'check_record',
] as const;

const pending: Promise<unknown>[] = [];

export function hasPendingTelemetry(): boolean {
  return pending.length > 0;
}

/** No-op when nothing is queued (including when opt-out suppressed emit). */
export async function flushTelemetry(timeoutMs = 200): Promise<void> {
  if (pending.length === 0) return;
  const batch = Promise.allSettled(pending.splice(0, pending.length));
  await Promise.race([batch, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/**
 * Fire-and-forget surface_active ping — never throws, never blocks the tool.
 * `command` must match /^[a-z_-]{1,32}$/ (MCP tool names already do).
 */
export function emitSurfaceActive(
  apiUrl: string,
  command: string,
  cwd: string = process.cwd(),
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void {
  if (!telemetryEnabled(env)) return;
  const p = fetch(`${apiUrl}/api/v1/analytics/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'surface_active',
      metadata: { surface: 'mcp', command, repoHash: repoHash(cwd) },
    }),
  }).then(
    () => {},
    () => {},
  );
  pending.push(p);
}
