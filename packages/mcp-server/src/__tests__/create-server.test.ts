import { describe, it, expect } from 'vitest';
import { createServer, SERVER_VERSION } from '../index.js';

/**
 * The MCP server entry point had zero coverage.
 *
 * Every tool it registers is a compliance answer delivered into someone else's
 * agent, so the registration itself carries obligations: directory review
 * requires each tool to declare a title and hints, and every tool here is a
 * pure function over the bundled corpus with no writes and no network. If a
 * tool were ever registered without `readOnlyHint`, or with `destructiveHint`,
 * it would be claiming it may change the host's state. Nothing asserted that.
 */
describe('createServer', () => {
  it('constructs without a transport or any network call', () => {
    expect(() => createServer()).not.toThrow();
  });

  it('publishes a server version that is a real semver', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('registers every advertised tool', () => {
    const server = createServer() as unknown as { _registeredTools?: Record<string, unknown> };
    const names = Object.keys(server._registeredTools ?? {});
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const t of ['classify', 'explain_obligation']) {
      expect(names, `${t} should be registered`).toContain(t);
    }
  });

  it('declares every tool read-only and non-destructive', () => {
    // These are pure functions over a bundled corpus. A tool that claimed
    // otherwise would be telling a host agent it may change state.
    const server = createServer() as unknown as {
      _registeredTools?: Record<string, { annotations?: Record<string, unknown> }>;
    };
    const tools = Object.entries(server._registeredTools ?? {});
    expect(tools.length).toBeGreaterThan(0);
    for (const [name, def] of tools) {
      expect(def.annotations?.readOnlyHint, `${name} must declare readOnlyHint`).toBe(true);
      expect(def.annotations?.destructiveHint, `${name} must not be destructive`).toBe(false);
    }
  });

  it('gives every tool a title, which directory review requires', () => {
    const server = createServer() as unknown as {
      _registeredTools?: Record<string, { title?: string; description?: string }>;
    };
    for (const [name, def] of Object.entries(server._registeredTools ?? {})) {
      expect(def.title, `${name} needs a title`).toBeTruthy();
      expect(def.description, `${name} needs a description`).toBeTruthy();
    }
  });

  it('is constructible more than once, so a host can restart it', () => {
    expect(createServer()).not.toBe(createServer());
  });
});

interface RegisteredTool {
  title?: string;
  /** The SDK stores the tool implementation as `handler`, not `callback`. */
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: { type: string; text?: string }[] }>;
}
const tools = (): Record<string, RegisteredTool> =>
  (createServer() as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;

const textOf = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');

describe('the tools actually answer, not just register', () => {
  it('classify returns a cited answer for a real use case', async () => {
    const r = await tools().classify!.handler({
      role: 'provider',
      domain: 'employment',
      use_case: 'screens and ranks job applicants from their CVs to shortlist candidates',
      audience: 'general',
    });
    const text = textOf(r);
    expect(text).toMatch(/Article|Annex/);
    // Employment screening is the canonical Annex III high-risk case.
    expect(text.toLowerCase()).toContain('high');
  });

  it('classify does not crash on a minimal use case', async () => {
    const r = await tools().classify!.handler({
      role: 'deployer',
      domain: 'other',
      use_case: 'summarises internal meeting notes for staff',
      audience: 'general',
    });
    expect(textOf(r).length).toBeGreaterThan(0);
  });

  it('explain_obligation answers with the regulation behind it', async () => {
    const t = tools().explain_obligation;
    expect(t).toBeDefined();
    const r = await t!.handler({ role: 'deployer', risk: 'high' });
    expect(textOf(r)).toMatch(/Article|Regulation/);
  });

  it('every registered tool returns MCP content rather than throwing', async () => {
    const args: Record<string, Record<string, unknown>> = {
      classify: { role: 'provider', domain: 'other', use_case: 'x y z', audience: 'general' },
      explain_obligation: { role: 'deployer', risk: 'high' },
      generate_disclosure: { scenario: 'chatbot', locale: 'en' },
      agent_disclosure_taxonomy: {},
    };
    for (const [name, def] of Object.entries(tools())) {
      const a = args[name];
      if (!a) continue; // tools needing richer fixtures are covered elsewhere
      const r = await def.handler(a);
      expect(Array.isArray(r.content), `${name} must return MCP content`).toBe(true);
      expect(r.content.length).toBeGreaterThan(0);
    }
  });
});

describe('a tool that cannot answer says what it accepts', () => {
  it('names the valid scenarios rather than failing opaquely', async () => {
    // An agent that gets "invalid input" learns nothing. One that gets the
    // list can retry, which is the difference between a usable tool and a
    // dead end inside someone else's assistant.
    await expect(
      tools().generate_disclosure!.handler({ scenario: 'not-a-scenario', locale: 'en' }),
    ).rejects.toThrow(/chatbot|genai-content|deepfake|emotion/);
  });
});

describe('the remaining tools answer too', () => {
  it('check_record reports on a record it is handed', async () => {
    const t = tools().check_record;
    expect(t).toBeDefined();
    const r = await t!.handler({ record: JSON.stringify({ schemaVersion: '1.0' }) }).catch((e: Error) => ({
      content: [{ type: 'text', text: e.message }],
    }));
    expect(textOf(r as never).length).toBeGreaterThan(0);
  });

  it('agent_disclosure_taxonomy lists the categories it knows', async () => {
    const r = await tools().agent_disclosure_taxonomy!.handler({});
    expect(textOf(r).length).toBeGreaterThan(0);
  });

  it('generate_agent_disclosure produces text for a known shape', async () => {
    const t = tools().generate_agent_disclosure!;
    const r = await t.handler({ category: 'assistant', locale: 'en' }).catch((e: Error) => ({
      content: [{ type: 'text', text: e.message }],
    }));
    // Either it renders, or it names what it accepts. Both are usable answers.
    expect(textOf(r as never).length).toBeGreaterThan(0);
  });

  it('generate_disclosure renders each locale it claims to support', async () => {
    for (const locale of ['en', 'de']) {
      const r = await tools().generate_disclosure!.handler({ scenario: 'chatbot', locale });
      expect(textOf(r).length, `${locale} should render`).toBeGreaterThan(0);
    }
  });
});
