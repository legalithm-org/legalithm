import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyUseCase } from '../lib/ai_act/engine';
import type { UseCase } from '../lib/ai_act/types';
import { RULES_ENGINE_META } from '../lib/ai_act/version';
import {
  classifyTool,
  explainObligationTool,
  generateDisclosureTool,
  checkRecordTool,
  obligationToItem,
  DISCLAIMER,
} from '../tools.js';

const INPUT: UseCase = { role: 'provider', domain: 'employment', use_case: 'screen and rank CVs', audience: 'workers' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyTool', () => {
  it('matches the engine and carries the disclaimer', () => {
    const r = classifyTool(INPUT);
    expect(r.risk).toBe(classifyUseCase(INPUT).risk);
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.asOf).toBe(RULES_ENGINE_META.updatedAt);
    expect(r.engineVersion).toBe(RULES_ENGINE_META.version);
  });
});

describe('explainObligationTool', () => {
  it('returns cited obligations for provider/high', () => {
    const r = explainObligationTool('provider', 'high');
    expect(r.count).toBeGreaterThan(0);
    expect(r.items[0]!.citation.article).toBeTruthy();
    expect(r.items[0]!.citation.url).toContain('eur-lex');
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.asOf).toBe(RULES_ENGINE_META.updatedAt);
    expect(r.engineVersion).toBe(RULES_ENGINE_META.version);
  });

  it('returns an empty list gracefully for a tier with no obligations', () => {
    expect(explainObligationTool('provider', 'minimal').count).toBe(0);
  });

  it('applies defensive defaults when an obligation lacks priority/guidance', () => {
    const item = obligationToItem({
      id: 'x', role: 'provider', risk: 'high', article: '9',
      reference_url: 'https://eur-lex.europa.eu/x', title: 'T', description: 'D', evidence_type: 'document',
    });
    expect(item.priority).toBe('medium');
    expect(item.how_to_prove).toContain('document evidence');
    expect(item.citation.article).toBe('9');
  });

  it('covers deployer tiers (high + limited) and always emits how_to_prove + priority', () => {
    for (const r of ['high', 'limited'] as const) {
      const res = explainObligationTool('deployer', r);
      expect(res.count).toBeGreaterThan(0);
      for (const item of res.items) {
        expect(item.how_to_prove.length).toBeGreaterThan(0); // guidance or the generated fallback
        expect(['high', 'medium', 'low']).toContain(item.priority); // priority or the 'medium' fallback
      }
    }
  });
});

describe('generateDisclosureTool', () => {
  it('returns a German Article 50 snippet', () => {
    const r = generateDisclosureTool('chatbot', 'de');
    expect(r.text).toMatch(/KI-System/);
    expect(r.article).toBe('Article 50');
    expect(r.citationUrl).toContain('eur-lex');
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.asOf).toBe(RULES_ENGINE_META.updatedAt);
    expect(r.engineVersion).toBe(RULES_ENGINE_META.version);
  });

  it('defaults to English', () => {
    expect(generateDisclosureTool('genai-content').locale).toBe('en');
  });
});

describe('checkRecordTool', () => {
  it('returns found:true on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ orgSlug: 'acme' }), { status: 200 })));
    expect((await checkRecordTool('acme', 'http://x')).found).toBe(true);
  });
  it('returns found:false on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect((await checkRecordTool('nope', 'http://x')).found).toBe(false);
  });
  it('returns found:false with an error on a 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const r = await checkRecordTool('x', 'http://x');
    expect(r.found).toBe(false);
    expect(r.error).toContain('500');
  });
  it('handles a transport failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    const r = await checkRecordTool('x', 'http://x');
    expect(r.found).toBe(false);
    expect(r.error).toContain('reach');
  });
});
