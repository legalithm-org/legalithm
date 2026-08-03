/**
 * Test-only signing key.
 *
 * Generated fresh in memory on import, so there is no private key anywhere in
 * the repository or in the published tarball. It is registered under its own
 * keyId, which means a signature produced here can never be mistaken for one
 * made with the real legalithm-record-v1 anchor.
 *
 * This file lives under __tests__/ and is excluded from tsconfig.build.json,
 * so it is not compiled into dist/.
 */

import { generateKeyPairSync, sign } from 'crypto';
import { registerVerificationKey, type DetachedRecordSignature } from '../record-signature.js';

export const TEST_KEY_ID = 'legalithm-record-test-ephemeral';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

registerVerificationKey(
  TEST_KEY_ID,
  publicKey.export({ type: 'spki', format: 'pem' }).toString(),
);

/** Sign a recordHash the way a real signer would, under the test keyId. */
export function signRecordHashForTest(recordHash: string): DetachedRecordSignature {
  const signature = sign(null, Buffer.from(recordHash, 'utf8'), privateKey).toString('base64');
  return { algorithm: 'Ed25519', keyId: TEST_KEY_ID, signature };
}
