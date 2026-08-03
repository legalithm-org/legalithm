import { describe, it, expect } from 'vitest';

import { detectStack, buildInventory, inferSystemCategory } from '../detect.js';
import { runDiscover } from '../commands/discover.js';
import type { InventoryItem } from '../types.js';

describe('inferSystemCategory (P2-B1)', () => {
  it('a chat/assistant route → chatbot', () => {
    const d = detectStack({ packageJson: { dependencies: { openai: '4' } }, filePaths: ['app/api/chat/route.ts'] });
    expect(inferSystemCategory(d.signals)).toBe('chatbot');
  });
  it('a generative SDK without a chat route → content_generation', () => {
    const d = detectStack({ packageJson: { dependencies: { openai: '4' } } });
    expect(inferSystemCategory(d.signals)).toBe('content_generation');
  });
  it('no AI signal → other', () => {
    const d = detectStack({ packageJson: { dependencies: { express: '4' } } });
    expect(inferSystemCategory(d.signals)).toBe('other');
  });
});

describe('buildInventory (P2-B1)', () => {
  it('proposes a deployer system with the AI stack as evidence + a PII data category', () => {
    const d = detectStack({ packageJson: { name: 'my-app', dependencies: { openai: '4', '@prisma/client': '6' } } });
    const item = buildInventory(d, 'my-app');
    expect(item.name).toBe('my-app');
    expect(item.role).toBe('deployer'); // using an AI SDK = deploying someone else's model
    expect(item.category).toBe('content_generation');
    expect(item.description).toMatch(/openai/);
    expect(item.dataCategories).toEqual(['personal data']); // prisma → PII
  });
  it('falls back to "app" and no data categories when nothing is detected', () => {
    const d = detectStack({ packageJson: { dependencies: {} } });
    const item = buildInventory(d, '   ');
    expect(item.name).toBe('app');
    expect(item.category).toBe('other');
    expect(item.dataCategories).toBeUndefined();
  });
});

describe('runDiscover (P2-B1)', () => {
  const detection = detectStack({ packageJson: { name: 'my-app', dependencies: { openai: '4' } } });

  it('prints the inventory and exits 0 without push', async () => {
    const lines: string[] = [];
    const res = await runDiscover({ detect: () => detection, name: 'my-app', json: false, log: (m) => lines.push(m) });
    expect(res.exitCode).toBe(0);
    const out = lines.join('\n');
    expect(out).toMatch(/Detected AI-relevant stack/);
    expect(out).toMatch(/openai/);
    expect(out).toMatch(/--push/); // nudges toward registering
  });

  it('pushes the proposed item and reports the classification, exit 0', async () => {
    let pushed: InventoryItem | null = null;
    const res = await runDiscover({
      detect: () => detection,
      name: 'my-app',
      json: false,
      push: async (item) => {
        pushed = item;
        return { id: 'sys1', riskTier: 'limited' };
      },
      log: () => {},
    });
    expect(res.exitCode).toBe(0);
    expect(pushed!.name).toBe('my-app');
    expect(pushed!.category).toBe('content_generation');
  });

  it('exits 3 when push fails, without crashing', async () => {
    const res = await runDiscover({
      detect: () => detection,
      name: 'my-app',
      json: false,
      push: async () => {
        throw new Error('Invalid or missing API key');
      },
      log: () => {},
    });
    expect(res.exitCode).toBe(3);
  });
});
