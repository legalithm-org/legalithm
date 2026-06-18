// Tiny zero-dependency argv parser. Supports: `cmd`, `--flag value`, `--flag=value`,
// boolean `--flag`, and positionals. No commander/yargs (stay dependency-light).

export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  // A leading token starting with '-' is a flag, not a command — so
  // `legalithm --help` / `legalithm -h` resolve to the help command instead of
  // being mistaken for a command name.
  const hasCommand = argv.length > 0 && !argv[0]!.startsWith('-');
  const command = hasCommand ? argv[0]! : 'help';
  const rest = hasCommand ? argv.slice(1) : argv;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }

  return { command, flags, positionals };
}

/** Read a flag as a string (undefined if absent or boolean). */
export function flagString(flags: ParsedArgs['flags'], key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

/** Read a flag as a boolean (true if present as a bare flag or "true"). */
export function flagBool(flags: ParsedArgs['flags'], key: string): boolean {
  const v = flags[key];
  return v === true || v === 'true';
}
