import { buildAiContentManifest, type AiContentManifestOptions } from './manifest.js';

/**
 * P2-C1: sign + embed the AI-content manifest into an asset using c2pa-node.
 *
 * c2pa-node is a large native dependency, so it is an OPTIONAL dependency of the
 * CLI and loaded lazily here: the base CLI stays dependency-free, and marking only
 * requires it when actually used. When no signer is supplied, a bundled test signer
 * is used, which produces a valid manifest that is not yet trust-listed (fine for
 * verifying the pipeline; a production certificate is supplied for real marking).
 */

/** True when the optional native dependency can be loaded. */
export async function isC2paAvailable(): Promise<boolean> {
  try {
    await import('c2pa-node');
    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadC2pa(): Promise<any> {
  try {
    return await import('c2pa-node');
  } catch {
    throw new Error(
      'C2PA marking needs the optional dependency "c2pa-node". Install it, e.g. `npm i c2pa-node`.',
    );
  }
}

export interface MarkImageOptions extends AiContentManifestOptions {
  buffer: Buffer;
  /** A pre-built c2pa-node signer. Omit to use the bundled test signer. */
  signer?: unknown;
}

/** Sign + embed a manifest declaring the buffer as AI-generated. Returns the signed asset. */
export async function markImage(opts: MarkImageOptions): Promise<Buffer> {
  const { createC2pa, createTestSigner, ManifestBuilder } = await loadC2pa();
  const signer = opts.signer ?? (await createTestSigner());
  const c2pa = createC2pa({ signer });
  const manifest = new ManifestBuilder(buildAiContentManifest(opts));
  const { signedAsset } = await c2pa.sign({
    asset: { buffer: opts.buffer, mimeType: opts.format },
    manifest,
  });
  return signedAsset.buffer as Buffer;
}

/** Read the C2PA manifest store from an asset (returns null when there is none). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readManifest(buffer: Buffer, mimeType: string): Promise<any> {
  const { createC2pa } = await loadC2pa();
  const c2pa = createC2pa({});
  return c2pa.read({ buffer, mimeType });
}

/** Whether an asset already carries at least one C2PA manifest. */
export async function hasManifest(buffer: Buffer, mimeType: string): Promise<boolean> {
  try {
    const read = await readManifest(buffer, mimeType);
    return Boolean(read && read.manifests && Object.keys(read.manifests).length > 0);
  } catch {
    return false;
  }
}

/** Build a c2pa-node local signer from a certificate + private key (production marking). */
export function buildLocalSigner(certificate: Buffer, privateKey: Buffer, algorithm = 'es256'): unknown {
  return { type: 'local', certificate, privateKey, algorithm };
}
