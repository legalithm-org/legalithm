// Anonymous, opt-out usage telemetry for the MCP server.
// Same privacy contract as packages/cli/src/telemetry.ts: surface + command +
// repoHash + idBasis only; DO_NOT_TRACK=1 / LEGALITHM_TELEMETRY=0 honoured;
// fire-and-forget. repoHash digests the project identity, not the cwd path.
import { createHash } from 'crypto';
import { spawnSync } from 'node:child_process';

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

/** One-way 16-hex digest. The input never leaves the machine. */
export function repoHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** What the identity was derived from. Sent alongside the hash. */
export type IdBasis = 'remote' | 'root' | 'cwd';

/**
 * Duplicated from packages/cli/src/telemetry.ts rather than imported: the two
 * are independently published packages and mcp-server does not depend on the
 * CLI. The privacy contract was already duplicated for that reason; this keeps
 * the identity definition beside it. Change both or neither.
 */
export function normaliseRemote(url: string): string {
  let s = url.trim();
  if (!s) return '';
  s = s.replace(/^[a-z+]+:\/\//i, '');
  s = s.replace(/^[^@/]*@/, '');
  s = s.replace(/^([^/:]+):(?!\d)/, '$1/');
  s = s.replace(/^([^/]+):\d+\//, '$1/');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return s.toLowerCase();
}

function git(args: string[], cwd: string): string | null {
  try {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status !== 0) return null;
    const out = String(r.stdout ?? '').trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * A project identity that survives the directory the server was started in.
 *
 * Hashing cwd made every ephemeral working directory a new "repo". For the CLI
 * that meant CI temp paths; for an MCP server it means whatever directory the
 * host launched it from, which is not necessarily the user's project and may not
 * be a repository at all.
 *
 * That last case is why `cwd` stays as a labelled floor rather than being
 * dropped. An MCP population reporting mostly `cwd` is telling us the server is
 * not running inside a checkout, which is a finding about who is calling it and
 * not a gap in the data.
 */
export function projectIdentity(cwd: string): { hash: string; basis: IdBasis } {
  const remote = git(['config', '--get', 'remote.origin.url'], cwd);
  const normalised = remote ? normaliseRemote(remote) : '';
  if (normalised) return { hash: repoHash(`remote:${normalised}`), basis: 'remote' };

  const root = git(['rev-parse', '--show-toplevel'], cwd);
  if (root) return { hash: repoHash(`root:${root}`), basis: 'root' };

  return { hash: repoHash(cwd), basis: 'cwd' };
}

/**
 * Resolved once per call site, so a tool invocation never shells out to git
 * twice for one ping.
 */
function identityMetadata(cwd: string): { repoHash: string; idBasis: IdBasis } {
  const { hash, basis } = projectIdentity(cwd);
  return { repoHash: hash, idBasis: basis };
}

/** MCP tool names emitted as command (must match /^[a-z_-]{1,32}$/). */
export const MCP_TELEMETRY_COMMANDS = [
  'classify',
  'explain_obligation',
  'generate_disclosure',
  'check_record',
  'generate_agent_disclosure',
  'agent_disclosure_taxonomy',
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
      metadata: { surface: 'mcp', command, ...identityMetadata(cwd) },
    }),
  }).then(
    () => {},
    () => {},
  );
  pending.push(p);
}
