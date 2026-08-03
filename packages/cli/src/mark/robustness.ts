/**
 * Testing and verification framework for the marking layers.
 *
 * The Code of Practice on marking and labelling AI-generated content asks
 * signatories to maintain a testing and verification framework, and to keep
 * their marking "effective, reliable and robust". A claim like that is only
 * meaningful if it is measured, so this module measures it: it applies a suite
 * of realistic transforms to a marked asset and reports which ones the
 * watermark survives.
 *
 * The point is to produce evidence, including negative evidence. Transforms
 * that are EXPECTED to defeat the watermark (heavy cropping, rotation) are part
 * of the suite deliberately, so the report states the limits rather than hiding
 * them. Anyone relying on this for a compliance record should publish the whole
 * table, not the passing rows.
 */

import { readWatermark } from './watermark.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSharp(): Promise<any> {
  const mod = await import('sharp');
  return (mod as { default?: unknown }).default ?? mod;
}

export interface TransformCase {
  name: string;
  /** What this simulates in the real world. */
  scenario: string;
  /** Whether the watermark is expected to survive. */
  expectSurvival: boolean;
  apply: (buffer: Buffer) => Promise<Buffer>;
}

export interface TransformOutcome {
  name: string;
  scenario: string;
  expectSurvival: boolean;
  survived: boolean;
  confidence: number;
  /** True when the measured result matches what we expect. */
  asExpected: boolean;
}

export interface RobustnessReport {
  generatedFor: string;
  total: number;
  survived: number;
  unexpected: TransformOutcome[];
  outcomes: TransformOutcome[];
}

/**
 * The standard suite.
 *
 * Survival-expected cases model ordinary redistribution, which is what strips a
 * C2PA manifest and is therefore the whole reason a second layer exists.
 */
export async function standardSuite(): Promise<TransformCase[]> {
  const sharp = await loadSharp();
  return [
    {
      name: 'jpeg-q90',
      scenario: 'Lossy re-encode at high quality (CMS or CDN pipeline)',
      expectSurvival: true,
      apply: (b) => sharp(b).jpeg({ quality: 90 }).toBuffer(),
    },
    {
      name: 'jpeg-q75',
      scenario: 'Lossy re-encode at typical web quality',
      expectSurvival: true,
      apply: (b) => sharp(b).jpeg({ quality: 75 }).toBuffer(),
    },
    {
      name: 'jpeg-q50',
      scenario: 'Aggressive compression (messaging apps)',
      expectSurvival: true,
      apply: (b) => sharp(b).jpeg({ quality: 50 }).toBuffer(),
    },
    {
      name: 'resize-down-512',
      scenario: 'Downscaled to a content width',
      expectSurvival: true,
      apply: (b) => sharp(b).resize(512).toBuffer(),
    },
    {
      name: 'resize-down-256',
      scenario: 'Thumbnail generation',
      expectSurvival: true,
      apply: (b) => sharp(b).resize(256).toBuffer(),
    },
    {
      name: 'resize-up-1600-jpeg',
      scenario: 'Upscaled and re-encoded',
      expectSurvival: true,
      apply: (b) => sharp(b).resize(1600).jpeg({ quality: 80 }).toBuffer(),
    },
    {
      name: 'strip-metadata-webp',
      scenario: 'Format conversion that discards all metadata (kills C2PA)',
      expectSurvival: true,
      apply: (b) => sharp(b).webp({ quality: 85 }).toBuffer(),
    },
    {
      name: 'greyscale',
      scenario: 'Colour removed',
      expectSurvival: true,
      apply: (b) => sharp(b).greyscale().toBuffer(),
    },
    // Known limits. These are expected to FAIL, and that is the point.
    {
      name: 'crop-70pct',
      scenario: 'Heavy crop, desynchronises the block lattice',
      expectSurvival: false,
      apply: async (b) => {
        const meta = await sharp(b).metadata();
        const w = Math.floor((meta.width ?? 100) * 0.7);
        const h = Math.floor((meta.height ?? 100) * 0.7);
        return sharp(b).extract({ left: 20, top: 20, width: w, height: h }).toBuffer();
      },
    },
    {
      name: 'rotate-90',
      scenario: 'Rotation, the lattice no longer aligns',
      expectSurvival: false,
      apply: (b) => sharp(b).rotate(90).toBuffer(),
    },
  ];
}

/** Run the suite against a marked asset and report what actually survived. */
export async function runRobustnessSuite(
  markedAsset: Buffer,
  label = 'asset',
  cases?: TransformCase[],
): Promise<RobustnessReport> {
  const suite = cases ?? (await standardSuite());
  const outcomes: TransformOutcome[] = [];

  for (const c of suite) {
    let survived = false;
    let confidence = 0;
    try {
      const transformed = await c.apply(markedAsset);
      const res = await readWatermark(transformed);
      survived = res.present;
      confidence = res.confidence;
    } catch {
      survived = false;
    }
    outcomes.push({
      name: c.name,
      scenario: c.scenario,
      expectSurvival: c.expectSurvival,
      survived,
      confidence,
      asExpected: survived === c.expectSurvival,
    });
  }

  return {
    generatedFor: label,
    total: outcomes.length,
    survived: outcomes.filter((o) => o.survived).length,
    unexpected: outcomes.filter((o) => !o.asExpected),
    outcomes,
  };
}

/** Render the report as a markdown table, for a compliance record. */
export function formatReport(report: RobustnessReport): string {
  const lines: string[] = [
    `# Marking robustness report: ${report.generatedFor}`,
    '',
    `${report.survived} of ${report.total} transforms preserved the watermark.`,
    '',
    '| Transform | Scenario | Expected | Measured | Confidence |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const o of report.outcomes) {
    lines.push(
      `| ${o.name} | ${o.scenario} | ${o.expectSurvival ? 'survives' : 'defeated'} | ${
        o.survived ? 'survived' : 'not detected'
      } | ${o.confidence.toFixed(2)} |`,
    );
  }
  if (report.unexpected.length > 0) {
    lines.push(
      '',
      `**${report.unexpected.length} result(s) did not match expectation:** ` +
        report.unexpected.map((o) => o.name).join(', '),
    );
  }
  lines.push(
    '',
    'Scope: this measures resilience to ordinary redistribution. It is not an',
    'adversarial guarantee. Generative regeneration attacks can remove pixel-level',
    'watermarks, and a motivated attacker who knows the scheme can defeat it.',
  );
  return lines.join('\n');
}
