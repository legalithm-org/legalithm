import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

/**
 * smithery.yaml is read by Smithery's scanner, not by anything we run, so a
 * typo in it fails silently at submission time rather than in CI. The riskiest
 * part is commandFunction: it is a JavaScript source string embedded in YAML,
 * which nothing type-checks. Parse it and actually call it here.
 */
describe('smithery.yaml', () => {
  const pkgDir = join(__dirname, '..', '..');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const config = yaml.load(readFileSync(join(pkgDir, 'smithery.yaml'), 'utf8')) as {
    startCommand: { type: string; configSchema: unknown; commandFunction: string };
  };

  it('declares a stdio start command', () => {
    expect(config.startCommand.type).toBe('stdio');
  });

  const call = (input: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`return (${config.startCommand.commandFunction});`)() as (
      c: unknown,
    ) => { command: string; args: string[]; env: Record<string, string> };
    return fn(input);
  };

  it('starts the published package by name, so the version is never pinned stale', () => {
    const { command, args } = call({});
    expect(command).toBe('npx');
    expect(args).toEqual(['-y', pkg.name]);
  });

  it('survives a missing config object rather than throwing on a property read', () => {
    expect(() => call(undefined)).not.toThrow();
    expect(() => call(null)).not.toThrow();
  });

  it('honours the documented telemetry opt-out, and only when explicitly false', () => {
    expect(call({ telemetry: false }).env).toEqual({ LEGALITHM_TELEMETRY: '0' });
    expect(call({ telemetry: true }).env).toEqual({});
    expect(call({}).env).toEqual({});
  });

  it('advertises no required configuration, since the server runs offline with none', () => {
    const schema = config.startCommand.configSchema as { required?: string[] };
    expect(schema.required ?? []).toEqual([]);
  });
});
