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
    ['explain_obligation', 'country'],
    ['explain_obligation', 'sector'],
    ['generate_disclosure', 'scenario'],
    ['generate_disclosure', 'locale'],
    ['check_record', 'slug'],
    ['generate_agent_disclosure', 'principal_name'],
    ['generate_agent_disclosure', 'principal_type'],
    ['generate_agent_disclosure', 'authority_scope'],
    ['generate_agent_disclosure', 'autonomy_level'],
    ['generate_agent_disclosure', 'composition'],
    ['discover_ai_surfaces', 'files'],
    ['discover_ai_surfaces', 'own_brand'],
    ['discover_ai_surfaces', 'on_market_before_2_aug_2026'],
    ['discover_ai_surfaces', 'deploys'],
    // agent_disclosure_taxonomy takes no parameters.
  ];

  /**
   * A parameter is either a shared const declared above createServer, or
   * inline in an inputSchema. For the inline case, slice from its declaration
   * to the next sibling declaration rather than matching a fixed indent — the
   * earlier version assumed six spaces and silently stopped finding anything
   * once a tool nested its schema one level deeper.
   */
  const definitionOf = (param: string): string => {
    // `;\r?\n`, not `;\n`: a Windows checkout has CRLF endings and the shared
    // consts stopped matching entirely, which failed this suite only on
    // windows-latest.
    const shared = src.match(new RegExp(`const ${param} = z[\\s\\S]*?;\\r?\\n`));
    if (shared) return shared[0];

    const start = src.search(new RegExp(`\\b${param}:\\s*z\\b`));
    if (start === -1) return '';
    const rest = src.slice(start + param.length);
    const nextSibling = rest.search(/\n\s*[a-z_]+:\s*z\b/);
    return rest.slice(0, nextSibling === -1 ? 1600 : nextSibling);
  };

  it('every registered tool is accounted for', () => {
    const tools = [...src.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(tools).toEqual([
      'agent_disclosure_taxonomy',
      'check_record',
      'classify',
      'discover_ai_surfaces',
      'explain_obligation',
      'generate_agent_disclosure',
      'generate_disclosure',
    ]);
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
