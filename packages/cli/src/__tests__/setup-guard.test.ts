import { describe, it, expect, vi } from 'vitest';
import { evaluateGuard, runGuard, formatHookOutput } from '../commands/guard.js';
import { mergeClaudeSettings, mergeMcpConfig } from '../commands/setup.js';
import type { StackDetectionResult } from '../types.js';

const detection = (usesGenAI: boolean): StackDetectionResult =>
  ({ signals: [], inferred: { usesGenAI, likelyArticle50: usesGenAI, handlesPII: false }, useCaseSeed: {}, disclaimer: '' } as StackDetectionResult);

describe('evaluateGuard', () => {
  it('passes (0) when there is no AI signal', () => {
    expect(evaluateGuard({ usesGenAI: false, recordExists: false })).toMatchObject({ status: 'no-ai', exitCode: 0 });
  });
  it('passes (0) when AI is present and a record exists', () => {
    expect(evaluateGuard({ usesGenAI: true, recordExists: true })).toMatchObject({ status: 'ok', exitCode: 0 });
  });
  it('BLOCKS (2) when AI is present without a record', () => {
    const r = evaluateGuard({ usesGenAI: true, recordExists: false });
    expect(r.status).toBe('missing-record');
    expect(r.exitCode).toBe(2);
    expect(r.message).toMatch(/no compliance record/i);
  });
  it('downgrades to warn (0) in warnOnly mode', () => {
    expect(evaluateGuard({ usesGenAI: true, recordExists: false, warnOnly: true })).toMatchObject({
      status: 'missing-record',
      exitCode: 0,
    });
  });
});

describe('formatHookOutput (Claude Code hook JSON)', () => {
  const blocking = evaluateGuard({ usesGenAI: true, recordExists: false });
  const ok = evaluateGuard({ usesGenAI: true, recordExists: true });

  it('Stop: emits the top-level {decision,reason} shape ONLY (Claude Code rejects extra keys)', () => {
    const { stdout, exitCode } = formatHookOutput(blocking, 'stop');
    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout!);
    expect(payload.decision).toBe('block');
    expect(payload.reason).toMatch(/policy|EU AI Act/i);
    // Verified live: adding hookSpecificOutput here fails Claude Code's strict
    // schema validation and the block is dropped. Must be the bare shape.
    expect(payload.hookSpecificOutput).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(['decision', 'reason']);
  });

  it('Stop reason is framed as owner policy, not an imperative command (anti prompt-injection)', () => {
    const payload = JSON.parse(formatHookOutput(blocking, 'stop').stdout!);
    expect(payload.reason).toMatch(/policy|owner/i);
  });

  it('PostToolUse: emits non-blocking additionalContext', () => {
    const { stdout, exitCode } = formatHookOutput(blocking, 'posttooluse');
    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout!);
    expect(payload.hookSpecificOutput).toMatchObject({ hookEventName: 'PostToolUse' });
    expect(payload.hookSpecificOutput.additionalContext).toMatch(/Legalithm/);
    expect(payload.decision).toBeUndefined(); // must NOT block a tool result
  });

  it('emits nothing (lets the agent proceed) when compliant', () => {
    expect(formatHookOutput(ok, 'stop')).toEqual({ stdout: null, exitCode: 0 });
    expect(formatHookOutput(ok, 'posttooluse')).toEqual({ stdout: null, exitCode: 0 });
  });
});

describe('runGuard', () => {
  it('returns 2 and logs the nudge when AI deps lack a record (plain/CI mode)', () => {
    const log = vi.fn();
    const code = runGuard({ detect: () => detection(true), recordExists: () => false, log });
    expect(code).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Legalithm/));
  });
  it('is silent and returns 0 when there is no AI', () => {
    const log = vi.fn();
    expect(runGuard({ detect: () => detection(false), recordExists: () => false, log })).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
  it('--hook stop: logs block JSON, exit 0', () => {
    const log = vi.fn();
    const code = runGuard({ detect: () => detection(true), recordExists: () => false, log }, { hook: 'stop' });
    expect(code).toBe(0);
    expect(JSON.parse(log.mock.calls[0]![0]).decision).toBe('block');
  });
  it('--hook stop: silent + 0 when compliant', () => {
    const log = vi.fn();
    expect(runGuard({ detect: () => detection(true), recordExists: () => true, log }, { hook: 'stop' })).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
  it('--hook stop: does NOT re-block when stop_hook_active (breaks the loop)', () => {
    const log = vi.fn();
    const code = runGuard(
      { detect: () => detection(true), recordExists: () => false, log },
      { hook: 'stop', stopHookActive: true },
    );
    expect(code).toBe(0);
    expect(log).not.toHaveBeenCalled(); // blocked once already; let it stop now
  });
  it('emits status JSON in --json mode', () => {
    const log = vi.fn();
    runGuard({ detect: () => detection(true), recordExists: () => true, log }, { json: true });
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ status: 'ok' });
  });
});

describe('mergeClaudeSettings', () => {
  it('adds PostToolUse + Stop guard hooks with the right hook modes', () => {
    const s = mergeClaudeSettings({}) as any;
    expect(JSON.stringify(s.hooks.PostToolUse)).toContain('guard --hook posttooluse');
    expect(JSON.stringify(s.hooks.Stop)).toContain('guard --hook stop');
    expect(s.hooks.PostToolUse[0].matcher).toBe('Write|Edit');
  });

  it('uses the provided CLI invocation (fast local form)', () => {
    const s = mergeClaudeSettings({}, 'npx legalithm') as any;
    expect(s.hooks.Stop[0].hooks[0].command).toBe('npx legalithm guard --hook stop');
  });

  it('is idempotent — re-running does not duplicate the hooks', () => {
    const once = mergeClaudeSettings({});
    const twice = mergeClaudeSettings(once) as any;
    expect(twice.hooks.PostToolUse).toHaveLength(1);
    expect(twice.hooks.Stop).toHaveLength(1);
  });

  it('preserves existing unrelated hooks', () => {
    const existing = { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } };
    const merged = mergeClaudeSettings(existing) as any;
    expect(merged.hooks.PostToolUse).toHaveLength(2);
    expect(JSON.stringify(merged.hooks.PostToolUse)).toContain('echo hi');
  });

  it('preserves other top-level settings keys', () => {
    const merged = mergeClaudeSettings({ model: 'opus', permissions: { allow: [] } }) as any;
    expect(merged.model).toBe('opus');
    expect(merged.permissions).toEqual({ allow: [] });
  });
});

describe('mergeMcpConfig', () => {
  it('registers the legalithm MCP server with stdio type + timeout', () => {
    const c = mergeMcpConfig({}) as any;
    expect(c.mcpServers.legalithm).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'legalithm-mcp-server'],
      timeout: 60000,
    });
  });
  it('preserves other servers and is idempotent', () => {
    const existing = { mcpServers: { other: { command: 'x' } } };
    const merged = mergeMcpConfig(mergeMcpConfig(existing)) as any;
    expect(merged.mcpServers.other).toEqual({ command: 'x' });
    expect(Object.keys(merged.mcpServers).sort()).toEqual(['legalithm', 'other']);
  });
});
