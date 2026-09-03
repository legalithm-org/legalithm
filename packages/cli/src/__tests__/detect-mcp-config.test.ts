import { describe, it, expect } from 'vitest';
import { isMcpConfigPath, listMcpServerNames, emptyAgentProfileStub, MCP_CONFIG_RELATIVE_PATHS } from '../detect.js';

/**
 * MCP config discovery: which files count, and what is read out of them.
 *
 * This decides whether an agent surface shows up in the record at all. A tool
 * that misses an MCP server misses the AI system, and Article 50 obligations
 * attach to the system rather than to the file it was declared in. The parsing
 * branches here handle files written by hand, so malformed input is the normal
 * case rather than the exception.
 */
describe('which files are MCP config', () => {
  it.each([...MCP_CONFIG_RELATIVE_PATHS])('recognises %s', (p) => {
    expect(isMcpConfigPath(p)).toBe(true);
  });

  it('rejects a lookalike that is not one of them', () => {
    expect(isMcpConfigPath('mcp.json')).toBe(false);
    expect(isMcpConfigPath('src/.mcp.json.bak')).toBe(false);
  });

  it('rejects an unrelated json file', () => {
    expect(isMcpConfigPath('package.json')).toBe(false);
  });
});

describe('reading server names out of a hand-written file', () => {
  it('lists the servers declared under mcpServers', () => {
    const names = listMcpServerNames(JSON.stringify({ mcpServers: { legalithm: {}, github: {} } }));
    expect(names.sort()).toEqual(['github', 'legalithm']);
  });

  it('returns nothing for valid JSON with no servers', () => {
    expect(listMcpServerNames(JSON.stringify({ other: true }))).toEqual([]);
  });

  it('returns nothing rather than throwing on malformed JSON', () => {
    // These files are hand-edited, so a trailing comma is the normal case.
    expect(listMcpServerNames('{ "mcpServers": { "a": {}, } }')).toEqual([]);
  });

  it('returns nothing for an empty string', () => {
    expect(listMcpServerNames('')).toEqual([]);
  });

  it('survives mcpServers being the wrong type', () => {
    expect(listMcpServerNames(JSON.stringify({ mcpServers: 'not an object' }))).toEqual([]);
  });
});

describe('the agent profile stub', () => {
  it('lists the tools it was given', () => {
    expect(emptyAgentProfileStub(['a', 'b']).tools).toEqual(['a', 'b']);
  });

  it('defaults to no tools rather than undefined', () => {
    expect(emptyAgentProfileStub().tools).toEqual([]);
  });
});
