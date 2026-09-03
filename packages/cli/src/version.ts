/**
 * The single source of the CLI's version literal.
 *
 * It lived inline in index.ts, which was fine while only `--version` printed it.
 * Hypothesis provenance now records which build produced a machine finding, and
 * that value has to be readable from cra/ without importing index.ts, which
 * would be circular.
 *
 * `version-sync.test.ts` pins this against package.json. It exists because the
 * literal once shipped as 0.4.3 while the published package was 0.4.4: vitest
 * does not read package.json and tsc does not compare string values, so nothing
 * else can catch it.
 */
export const VERSION = '0.8.0';

/** What goes in a hypothesis's `provenance.tool`. */
export const TOOL_ID = 'legalithm-cli';
