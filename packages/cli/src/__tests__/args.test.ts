import { describe, it, expect } from 'vitest';
import { parseArgs, flagString, flagBool } from '../args.js';

describe('parseArgs', () => {
  it('defaults to the help command with no argv', () => {
    expect(parseArgs([])).toEqual({ command: 'help', flags: {}, positionals: [] });
  });

  it('treats a leading --help / -h as the help command, not a command name', () => {
    // Regression: `legalithm --help` used to parse '--help' as the command and
    // fall through to the API-key check ("No API key found").
    expect(parseArgs(['--help'])).toEqual({ command: 'help', flags: { help: true }, positionals: [] });
    expect(parseArgs(['-h']).command).toBe('help');
    expect(parseArgs(['--version']).command).toBe('help');
  });

  it('parses a command + positionals', () => {
    expect(parseArgs(['check', 'foo', 'bar'])).toEqual({
      command: 'check',
      flags: {},
      positionals: ['foo', 'bar'],
    });
  });

  it('parses --flag value and --flag=value', () => {
    const a = parseArgs(['init', '--role', 'provider', '--domain=employment']);
    expect(a.command).toBe('init');
    expect(a.flags).toEqual({ role: 'provider', domain: 'employment' });
  });

  it('treats a trailing or pre---flag flag as boolean', () => {
    expect(parseArgs(['check', '--json']).flags).toEqual({ json: true });
    expect(parseArgs(['init', '--yes', '--role', 'deployer']).flags).toEqual({ yes: true, role: 'deployer' });
  });

  it('helpers read flags as string / bool', () => {
    const { flags } = parseArgs(['init', '--role', 'provider', '--yes']);
    expect(flagString(flags, 'role')).toBe('provider');
    expect(flagString(flags, 'missing')).toBeUndefined();
    expect(flagString(flags, 'yes')).toBeUndefined(); // boolean, not string
    expect(flagBool(flags, 'yes')).toBe(true);
    expect(flagBool(flags, 'role')).toBe(false);
    expect(flagBool(flags, 'missing')).toBe(false);
  });
});
