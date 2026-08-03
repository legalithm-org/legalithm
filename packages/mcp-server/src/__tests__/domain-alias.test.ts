import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyUseCase } from '../lib/ai_act/engine';
import type { UseCase } from '../lib/ai_act/types';

/**
 * W3/T3.3 renamed the `credit` domain to `essential-services`. legalithm-mcp-server
 * 0.1.3 is published with `credit` in its advertised tool schema, and agents cache
 * tool schemas, so dropping it would fail validation for anyone still holding the
 * old one. It stays accepted and normalises.
 */
describe('deprecated domain alias', () => {
  const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  it('still advertises `credit` in the classify tool schema', () => {
    expect(src).toMatch(/'credit',?\s*\/\/ deprecated/);
  });

  it('maps credit -> essential-services', () => {
    expect(src).toMatch(/DEPRECATED_DOMAIN_ALIASES[^=]*=\s*\{\s*credit:\s*'essential-services'/);
  });

  it('normalizeUseCase runs before the engine on classify', () => {
    expect(src).toMatch(/classifyTool\(normalizeUseCase\(args\)\)/);
  });

  it('the engine treats essential-services as an Annex III domain', () => {
    const useCase: UseCase = {
      role: 'provider',
      domain: 'essential-services',
      use_case: 'Credit scoring for consumer loan applications in the EU.',
      audience: 'general',
    };
    const result = classifyUseCase(useCase);
    expect(result.risk).toBe('high');
  });
});
