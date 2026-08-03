/**
 * P2-C1: Article 50(2) content marking. Builds the C2PA manifest that declares an
 * asset as AI-generated, using the IPTC digital-source-type vocabulary the C2PA /
 * Content Credentials ecosystem reads. Pure and dependency-free (the signing is
 * separate), so the manifest shape is testable without the native signer.
 */

/** IPTC digital source type for synthetic media created by a trained algorithm. */
export const TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

export interface AiContentManifestOptions {
  /** Asset title (usually the file name). */
  title: string;
  /** MIME type, e.g. "image/jpeg". */
  format: string;
  /** The AI tool that generated the content (e.g. a model name). */
  softwareAgent?: string;
  /** Overrides the claim-generator string. */
  claimGenerator?: string;
}

export interface C2paManifestSpec {
  claim_generator: string;
  format: string;
  title: string;
  assertions: Array<{ label: string; data: unknown }>;
}

/** Build a C2PA manifest declaring the asset as AI-generated (Article 50(2)). */
export function buildAiContentManifest(opts: AiContentManifestOptions): C2paManifestSpec {
  return {
    claim_generator: opts.claimGenerator ?? 'legalithm/1.0',
    format: opts.format,
    title: opts.title,
    assertions: [
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            {
              action: 'c2pa.created',
              softwareAgent: opts.softwareAgent ?? 'AI',
              digitalSourceType: TRAINED_ALGORITHMIC_MEDIA,
            },
          ],
        },
      },
    ],
  };
}
