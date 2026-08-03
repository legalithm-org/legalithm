import { describe, it, expect } from 'vitest';

import {
  buildPayloadBits,
  parsePayloadBits,
  chipSequence,
  PAYLOAD_BITS,
  GRID,
  MAGIC,
  WATERMARK_VERSION,
} from '../mark/watermark.js';

describe('watermark payload encoding', () => {
  it('round-trips the magic byte and version', () => {
    const bits = buildPayloadBits(WATERMARK_VERSION);
    expect(bits).toHaveLength(PAYLOAD_BITS);
    expect(parsePayloadBits(bits)).toEqual({ version: WATERMARK_VERSION });
  });

  it('round-trips an arbitrary version', () => {
    expect(parsePayloadBits(buildPayloadBits(7))).toEqual({ version: 7 });
  });

  it('rejects a payload whose magic byte does not match', () => {
    const bits = buildPayloadBits();
    bits[0] ^= 1; // corrupt the top bit of the magic byte
    expect(parsePayloadBits(bits)).toBeNull();
  });

  it('rejects a wrong-length payload', () => {
    expect(parsePayloadBits(new Uint8Array(8))).toBeNull();
  });

  it('encodes the magic byte in the high 8 bits', () => {
    const bits = buildPayloadBits();
    let high = 0;
    for (let i = 0; i < 8; i++) high = (high << 1) | bits[i];
    expect(high).toBe(MAGIC);
  });
});

describe('chip sequence', () => {
  it('is deterministic, so extraction can reproduce embedding', () => {
    expect(Array.from(chipSequence(64))).toEqual(Array.from(chipSequence(64)));
  });

  it('only ever emits +1 or -1', () => {
    expect(new Set(Array.from(chipSequence(512)))).toEqual(new Set([1, -1]));
  });

  it('is close to zero-mean, which keeps the pattern visually inert', () => {
    const chips = chipSequence(GRID * GRID);
    const sum = chips.reduce((a: number, b: number) => a + b, 0);
    // Within 10% of balanced across 1024 blocks.
    expect(Math.abs(sum)).toBeLessThan(GRID * GRID * 0.1);
  });

  it('differs when seeded differently', () => {
    expect(Array.from(chipSequence(64, 1))).not.toEqual(Array.from(chipSequence(64, 2)));
  });
});

// Pixel work needs the optional native dependency; skip cleanly when absent.
const hasSharp = await import('sharp')
  .then(() => true)
  .catch(() => false);

/** A textured test image; flat colour is unrepresentative of real content. */
async function noisyImage(width = 640, height = 480): Promise<Buffer> {
  const sharpMod = await import('sharp');
  const sharp = (sharpMod as { default?: unknown }).default ?? sharpMod;
  const px = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // Mid-tone base with texture, so blocks are not uniform.
    px[i] = 90 + (seed % 80);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sharp as any)(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe.skipIf(!hasSharp)('watermark embed and detect', () => {
  it('detects a watermark it embedded', async () => {
    const { embedWatermark, readWatermark } = await import('../mark/watermark.js');
    const marked = await embedWatermark({ buffer: await noisyImage(), format: 'png' });
    const res = await readWatermark(marked);
    expect(res.present).toBe(true);
    expect(res.version).toBe(WATERMARK_VERSION);
  });

  it('does NOT report a watermark on unmarked content', async () => {
    const { readWatermark } = await import('../mark/watermark.js');
    const res = await readWatermark(await noisyImage());
    expect(res.present).toBe(false);
  });

  it('separates marked from unmarked by a clear confidence margin', async () => {
    const { embedWatermark, readWatermark } = await import('../mark/watermark.js');
    const plain = await noisyImage();
    const marked = await embedWatermark({ buffer: plain, format: 'png' });
    const a = await readWatermark(marked);
    const b = await readWatermark(plain);
    // The whole detection rests on this gap being wide.
    expect(a.confidence).toBeGreaterThan(b.confidence * 2);
  });

  it('carries a non-default version through embedding', async () => {
    const { embedWatermark, readWatermark } = await import('../mark/watermark.js');
    const marked = await embedWatermark({ buffer: await noisyImage(), format: 'png', version: 9 });
    expect((await readWatermark(marked)).version).toBe(9);
  });

  it('returns not-present rather than throwing on non-image input', async () => {
    const { readWatermark } = await import('../mark/watermark.js');
    const res = await readWatermark(Buffer.from('this is not an image'));
    expect(res.present).toBe(false);
  });

  // Regression: each pass shifts luminance again, so re-marking compounded the
  // signal (3.91 -> 7.82 -> 11.74) and progressively degraded the image.
  it('is idempotent: marking twice does not compound the signal', async () => {
    const { embedWatermark, readWatermark } = await import('../mark/watermark.js');
    const once = await embedWatermark({ buffer: await noisyImage(), format: 'png' });
    const twice = await embedWatermark({ buffer: once, format: 'png' });

    const a = await readWatermark(once);
    const b = await readWatermark(twice);
    expect(b.present).toBe(true);
    // Unchanged, not doubled.
    expect(b.confidence).toBeCloseTo(a.confidence, 5);
    expect(twice.equals(once)).toBe(true);
  });

  it('force re-embeds, which is how the compounding is reproduced', async () => {
    const { embedWatermark, readWatermark } = await import('../mark/watermark.js');
    const once = await embedWatermark({ buffer: await noisyImage(), format: 'png' });
    const forced = await embedWatermark({ buffer: once, format: 'png', force: true });

    const a = await readWatermark(once);
    const b = await readWatermark(forced);
    expect(b.confidence).toBeGreaterThan(a.confidence * 1.5);
  });
});

describe.skipIf(!hasSharp)('robustness suite (Commitment 4 evidence)', () => {
  it('survives ordinary redistribution and fails only where documented', async () => {
    const { embedWatermark } = await import('../mark/watermark.js');
    const { runRobustnessSuite, formatReport } = await import('../mark/robustness.js');

    const marked = await embedWatermark({ buffer: await noisyImage(), format: 'png' });
    const report = await runRobustnessSuite(marked, 'test-image');

    // Every outcome must match its documented expectation, including the
    // transforms we expect to defeat the watermark. A surprise in either
    // direction means the published limits are wrong.
    const surprises = report.unexpected.map((o) => `${o.name} (expected ${o.expectSurvival})`);
    expect(surprises).toEqual([]);

    // Sanity: the suite covers both survival and known-limit cases.
    expect(report.outcomes.some((o) => o.expectSurvival)).toBe(true);
    expect(report.outcomes.some((o) => !o.expectSurvival)).toBe(true);

    const md = formatReport(report);
    expect(md).toContain('Marking robustness report');
    expect(md).toContain('not an');
  }, 60_000);
});
