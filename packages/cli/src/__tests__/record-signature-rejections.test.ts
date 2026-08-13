import { describe, it, expect, afterEach } from 'vitest';
import {
  parseSignatureFile,
  verifyDetachedSignature,
  registerVerificationKey,
  clearRegisteredVerificationKeys,
} from '../record-signature.js';

/**
 * The happy path was covered; every rejection branch was not, and on a
 * signature verifier the rejections ARE the feature. Anything that returns true
 * when it should throw is a forged record accepted as genuine.
 *
 * This module already had one incident: it shipped with the private half of the
 * only trusted key in the repo, which let anyone mint a valid signature. That
 * was caught by the mirror's secret gate rather than by a test.
 */
describe('record signature — rejection paths', () => {
  afterEach(() => clearRegisteredVerificationKeys());

  describe('parseSignatureFile', () => {
    it('rejects an algorithm other than Ed25519', () => {
      // Downgrade to a weaker or attacker-chosen algorithm.
      expect(() =>
        parseSignatureFile(JSON.stringify({ algorithm: 'RS256', keyId: 'k', signature: 's' })),
      ).toThrow(/Unsupported signature algorithm/);
    });

    it('rejects a missing algorithm', () => {
      expect(() => parseSignatureFile(JSON.stringify({ keyId: 'k', signature: 's' }))).toThrow(
        /Unsupported signature algorithm/,
      );
    });

    it('rejects a missing keyId', () => {
      expect(() =>
        parseSignatureFile(JSON.stringify({ algorithm: 'Ed25519', signature: 's' })),
      ).toThrow(/missing keyId/);
    });

    it('rejects a non-string keyId', () => {
      expect(() =>
        parseSignatureFile(JSON.stringify({ algorithm: 'Ed25519', keyId: 42, signature: 's' })),
      ).toThrow(/missing keyId/);
    });

    it('rejects a missing signature', () => {
      expect(() => parseSignatureFile(JSON.stringify({ algorithm: 'Ed25519', keyId: 'k' }))).toThrow(
        /missing signature/,
      );
    });

    it('rejects a non-string signature', () => {
      expect(() =>
        parseSignatureFile(JSON.stringify({ algorithm: 'Ed25519', keyId: 'k', signature: {} })),
      ).toThrow(/missing signature/);
    });

    it('rejects malformed JSON rather than returning a partial object', () => {
      expect(() => parseSignatureFile('{ not json')).toThrow();
    });

    it('accepts a well-formed file and normalises the algorithm field', () => {
      const parsed = parseSignatureFile(
        JSON.stringify({ algorithm: 'Ed25519', keyId: 'legalithm-record-v1', signature: 'abc' }),
      );
      expect(parsed).toEqual({ algorithm: 'Ed25519', keyId: 'legalithm-record-v1', signature: 'abc' });
    });
  });

  describe('verifyDetachedSignature', () => {
    it('refuses an unknown keyId instead of silently failing verification', () => {
      // Throwing matters more than returning false: a caller that treats false
      // and "unknown key" the same cannot tell a forgery from a typo.
      expect(() =>
        verifyDetachedSignature('hash', {
          algorithm: 'Ed25519',
          keyId: 'not-a-real-key',
          signature: 'AAAA',
        }),
      ).toThrow(/Unknown signature keyId/);
    });

    it('returns false for a well-formed signature that does not match', () => {
      const { publicKeyPem, keyId } = makeEphemeralKey();
      registerVerificationKey(keyId, publicKeyPem);
      expect(
        verifyDetachedSignature('hash', {
          algorithm: 'Ed25519',
          keyId,
          signature: Buffer.from('not a real signature').toString('base64'),
        }),
      ).toBe(false);
    });

    it('refuses to let a registered key shadow a built-in one', () => {
      // Overriding a trusted key id would turn key registration into a forgery
      // primitive; the guard is the whole reason registration is safe to expose.
      const { publicKeyPem } = makeEphemeralKey();
      expect(() => registerVerificationKey('legalithm-record-v1', publicKeyPem)).toThrow(
        /Refusing to override/,
      );
    });
  });
});

function makeEphemeralKey() {
  // Generated per-run, never committed. The incident this module had was a
  // committed private key, so tests must not reintroduce one.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
  const { publicKey } = generateKeyPairSync('ed25519');
  return {
    keyId: 'ephemeral-test-key',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
