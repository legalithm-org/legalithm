import { describe, it, expect } from 'vitest';
import { generateAgentDisclosureTool, agentDisclosureTaxonomyTool } from '../tools.js';

/**
 * Agent Disclosure Kit over MCP — Commission Article 50 Guidelines, 20 Jul 2026.
 *
 * The behaviour worth pinning is the refusal. Para 31 requires an agent to
 * disclose both its artificial nature and the person on whose behalf it acts,
 * and an agent calling this tool has every incentive to fill in a plausible
 * principal from the repo name or the git author. A disclosure naming a
 * principal nobody declared is worse than none: it reads as compliant and is
 * false, and the person relying on it is the one who gets hurt.
 */
describe('generate_agent_disclosure', () => {
  const declared = {
    principalName: 'Acme GmbH',
    principalType: 'legal_person',
    authorityScope: 'schedule meetings and send calendar invitations to Acme staff',
    autonomyLevel: 'supervised',
    composition: null,
  };

  it('refuses, and names the missing fields, when the principal is undeclared', () => {
    const out = generateAgentDisclosureTool({
      principalName: null,
      principalType: null,
      authorityScope: null,
      autonomyLevel: 'supervised',
      composition: null,
    });
    expect(out.ok).toBe(false);
    expect(out).toHaveProperty('missingFields', ['principalName', 'authorityScope']);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('treats a %s principal as undeclared rather than valid', (_label, value) => {
    const out = generateAgentDisclosureTool({ ...declared, principalName: value });
    expect(out.ok).toBe(false);
    expect((out as { missingFields: string[] }).missingFields).toContain('principalName');
  });

  it('never emits the declared principal anywhere in a refusal payload', () => {
    // The draft is returned so a caller can see the shape, but it must not have
    // invented a name to fill the gap.
    const out = generateAgentDisclosureTool({
      principalName: null,
      principalType: null,
      authorityScope: null,
      autonomyLevel: null,
      composition: null,
    });
    expect(JSON.stringify(out)).not.toMatch(/Acme|Legalithm GmbH/);
  });

  it('generates a cited artifact once the principal and scope are declared', () => {
    const out = generateAgentDisclosureTool(declared);
    expect(out.ok).toBe(true);
    const artifact = out as unknown as {
      principalStatement: string;
      authorityScopeStatement: string;
      redisclosureTriggers: Array<{ when: string }>;
      guidelinesAdopted: string;
      text: string;
    };
    expect(artifact.principalStatement).toContain('Acme GmbH');
    expect(artifact.authorityScopeStatement).toContain('schedule meetings');
    expect(artifact.guidelinesAdopted).toBe('2026-07-20');
  });

  it('carries all four re-disclosure triggers from para 31', () => {
    const out = generateAgentDisclosureTool(declared) as unknown as {
      redisclosureTriggers: Array<{ id: string }>;
    };
    expect(out.redisclosureTriggers.map((t) => t.id)).toEqual([
      'authorisation',
      'reporting',
      'validation',
      'new_interaction',
    ]);
  });

  it('carries the engine metadata every tool returns', () => {
    const out = generateAgentDisclosureTool(declared) as unknown as Record<string, unknown>;
    expect(out.asOf).toBeTypeOf('string');
    expect(out.disclaimer).toContain('not legal advice');
  });
});

describe('agent_disclosure_taxonomy', () => {
  it('returns the six positive dimensions', () => {
    const out = agentDisclosureTaxonomyTool() as unknown as {
      positiveDimensions: Array<{ id: string }>;
    };
    expect(out.positiveDimensions.map((d) => d.id)).toEqual([
      'artificial_nature',
      'principal_identity',
      'delegated_authority_scope',
      'multi_agent_composition',
      'architecture_level_disclosure',
      'redisclosure_triggers',
    ]);
  });

  /**
   * The negative scope is the half a developer actually needs: it is what stops
   * someone building disclosure into chain-of-thought or backend calls that the
   * Guidelines explicitly exclude. Shipping the positives alone would produce
   * over-disclosure, which is its own kind of wrong answer.
   */
  it('returns the negative scope, which is what prevents over-disclosure', () => {
    const out = agentDisclosureTaxonomyTool() as unknown as {
      negativeScope: Array<{ id: string }>;
    };
    expect(out.negativeScope.map((d) => d.id)).toEqual([
      'intermediate_reasoning',
      'unperceived_actions',
      'backend_m2m',
      'agent_to_agent',
    ]);
  });
});
