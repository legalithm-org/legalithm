import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every tool parameter must carry a .describe().
 *
 * Glama scored parameter documentation 2/5 with "schema description coverage is
 * 0%", but the score is the smaller problem: an agent picking `domain` from an
 * eleven-value enum with no guidance is guessing, and a wrong domain yields a
 * confidently wrong risk tier from a tool that worked perfectly. That is the
 * exact failure this server exists to prevent.
 *
 * Read from source rather than by importing index.ts, for the same reason
 * version-sync.test.ts does: importing pulls in @modelcontextprotocol/sdk,
 * which is a package-level dependency and is absent at the monorepo root where
 * the shared vitest config runs.
 *
 * Spawning the built server and reading a real tools/list would be stronger,
 * and was tried: under vitest the child exits immediately with empty stdout,
 * because a worker thread does not hand it a usable stdio transport. Wire-level
 * coverage was confirmed by hand instead (9/9 parameters described); this test
 * exists to stop it regressing.
 */
describe('tool parameter descriptions', () => {
  const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  /**
   * Listed explicitly rather than parsed out of the source. Two earlier
   * attempts — a brace-walking parser and a spawned server — were each more
   * fragile than the thing they guarded. If you add a parameter, add it here;
   * the count assertion below is what makes forgetting visible.
   */
  const PARAMETERS: Array<[tool: string, param: string]> = [
    ['classify', 'role'],
    ['classify', 'domain'],
    ['classify', 'use_case'],
    ['classify', 'audience'],
    ['explain_obligation', 'role'],
    ['explain_obligation', 'risk'],
    ['generate_disclosure', 'scenario'],
    ['generate_disclosure', 'locale'],
    ['check_record', 'slug'],
  ];

  const definitionOf = (param: string): string => {
    // Either declared inline in the inputSchema, or as a shared const above.
    const shared = src.match(new RegExp(`const ${param} = z[\\s\\S]*?;\\n`));
    if (shared) return shared[0];
    const inline = src.match(new RegExp(`\\b${param}: z[\\s\\S]{0,900}?\\n\\s{6}[a-z_]+[,:]`));
    return inline?.[0] ?? '';
  };

  it('the four tools are all registered', () => {
    const tools = [...src.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(tools).toEqual(['check_record', 'classify', 'explain_obligation', 'generate_disclosure']);
  });

  it('every parameter carries a .describe()', () => {
    const missing: string[] = [];
    for (const [tool, param] of PARAMETERS) {
      const def = definitionOf(param);
      // A one-liner is worse than nothing: it reads as documented while telling
      // an agent only what the parameter name already said.
      const described = /\.describe\(\s*\n?\s*['"`][\s\S]{40,}?['"`],?\s*\n?\s*\)/.test(def);
      if (!described) missing.push(`${tool}.${param}`);
    }
    expect(missing, 'parameters missing a usable description').toEqual([]);
  });

  /**
   * Catches a parameter added to index.ts without being added to PARAMETERS
   * above, which would otherwise leave it silently unchecked.
   */
  it('no parameter has been added without a description', () => {
    // Comments are stripped first: the doc comment above this suite contains
    // the words ".describe()" in prose and was counted as a ninth call.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const describeCalls = (code.match(/\.describe\(/g) ?? []).length;
    // Distinct, not total: `role` is one shared const used by two tools.
    const distinct = new Set(PARAMETERS.map(([, p]) => p)).size;
    expect(describeCalls, 'a .describe() exists that PARAMETERS does not cover').toBe(distinct);
  });
});
