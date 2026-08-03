import { describe, it, expect } from 'vitest';

import { buildAiContentManifest, TRAINED_ALGORITHMIC_MEDIA } from '../mark/manifest.js';

// A tiny 8x8 JPEG, so the roundtrip needs no image-generation dependency.
const TINY_JPEG_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCCACKg/9k=';

describe('AI-content manifest spec (P2-C1)', () => {
  it('declares c2pa.created with the trained-algorithmic-media source type', () => {
    const m = buildAiContentManifest({ title: 't.jpg', format: 'image/jpeg', softwareAgent: 'DALL-E' });
    const assertion = m.assertions.find((a) => a.label === 'c2pa.actions');
    const actions = (assertion?.data as { actions: Array<Record<string, string>> }).actions;
    expect(actions[0].action).toBe('c2pa.created');
    expect(actions[0].digitalSourceType).toBe(TRAINED_ALGORITHMIC_MEDIA);
    expect(actions[0].softwareAgent).toBe('DALL-E');
    expect(m.format).toBe('image/jpeg');
    expect(m.claim_generator).toContain('legalithm');
  });
});

// The roundtrip needs the optional native dependency; skip cleanly when absent
// (e.g. CI that did not install the CLI package's optional deps).
const hasC2pa = await import('c2pa-node')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!hasC2pa)('C2PA sign + read roundtrip (P2-C1)', () => {
  it('a test image comes back with a valid manifest declaring AI-generated content', async () => {
    const { markImage, readManifest } = await import('../mark/c2pa.js');
    const jpeg = Buffer.from(TINY_JPEG_BASE64, 'base64');

    const signed = await markImage({ buffer: jpeg, format: 'image/jpeg', title: 't.jpg', softwareAgent: 'Legalithm' });
    expect(signed.length).toBeGreaterThan(jpeg.length);

    const read = await readManifest(signed, 'image/jpeg');
    expect(read).toBeTruthy();
    const key = Object.keys(read.manifests ?? {})[0];
    expect(key).toBeTruthy();
    const am = read.manifests[key];
    const actions = am.assertions?.find((a: { label: string }) => a.label === 'c2pa.actions')?.data?.actions;
    expect(actions?.[0]?.digitalSourceType).toBe(TRAINED_ALGORITHMIC_MEDIA);
    expect((read.validation_status ?? []).length).toBe(0);
  });
});
