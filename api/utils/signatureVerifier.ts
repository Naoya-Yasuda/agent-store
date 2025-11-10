import { createHash, createVerify } from 'crypto';
import { stableStringify } from './json';

export type SignatureAlgorithm = 'rsa-sha256' | 'ecdsa-sha256';

export interface SignatureBundle {
  algorithm: SignatureAlgorithm;
  publicKeyPem: string;
  signature: string; // base64
  payloadDigest: string; // hex(SHA256)
}

export interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
}

export function verifySignatureBundle(bundle: SignatureBundle, payload: unknown): SignatureVerificationResult {
  const canonicalPayload = stableStringify(payload);
  const digest = createHash('sha256').update(canonicalPayload).digest('hex');
  if (digest !== bundle.payloadDigest.toLowerCase()) {
    return {
      valid: false,
      error: 'payload_digest_mismatch'
    };
  }

  try {
    const verifier = createVerify(resolveAlgorithm(bundle.algorithm));
    verifier.update(canonicalPayload, 'utf8');
    verifier.end();
    const signatureBuffer = Buffer.from(bundle.signature, 'base64');
    const verified = verifier.verify(bundle.publicKeyPem, signatureBuffer);
    if (!verified) {
      return { valid: false, error: 'signature_invalid' };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'signature_verification_failed'
    };
  }
}

function resolveAlgorithm(algorithm: SignatureAlgorithm): string {
  if (algorithm === 'ecdsa-sha256') {
    return 'sha256';
  }
  return 'RSA-SHA256';
}
