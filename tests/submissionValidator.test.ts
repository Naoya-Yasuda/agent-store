import { createSign, generateKeyPairSync, createHash } from 'crypto';
import { validateSubmissionPayload } from '../api/utils/submissionValidator';
import { stableStringify } from '../api/utils/json';

function buildValidCard() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    agentId: '22222222-2222-2222-2222-222222222222',
    defaultLocale: 'ja-JP',
    translations: [
      {
        locale: 'ja-JP',
        displayName: '審査用サンプル',
        shortDescription: '審査説明',
        capabilities: ['検索'],
        useCases: ['FAQ検索']
      }
    ],
    status: 'draft',
    executionProfile: 'self_hosted'
  };
}

function buildManifest() {
  return {
    openapi: '3.1.0',
    info: { title: 'Sample', version: '1.0.0' },
    paths: {
      '/search': {
        post: {
          summary: '検索機能の呼び出し',
          tags: ['検索']
        }
      }
    }
  };
}

function signCard(card: unknown) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });
  const canonical = stableStringify(card);
  const digest = createHash('sha256').update(canonical).digest('hex');
  const signer = createSign('RSA-SHA256');
  signer.update(canonical, 'utf8');
  signer.end();
  const signature = signer.sign(privateKey, 'base64');
  return {
    bundle: {
      algorithm: 'rsa-sha256' as const,
      publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      signature,
      payloadDigest: digest
    },
    digest
  };
}

describe('Submission payload validation', () => {
  it('accepts valid submission payload', () => {
    const card = buildValidCard();
    const manifest = buildManifest();
    const { bundle } = signCard(card);
    const result = validateSubmissionPayload({
      agentId: card.agentId,
      cardDocument: card,
      endpointManifest: manifest,
      signatureBundle: bundle,
      organization: {
        organizationId: 'org-1',
        name: 'Org',
        contactEmail: 'ops@example.com',
        operatorPublicKey: bundle.publicKeyPem
      }
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifestWarnings.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects payload with signature mismatch', () => {
    const card = buildValidCard();
    const manifest = buildManifest();
    const { bundle } = signCard(card);
    const tampered = { ...card, displayName: '改ざん済み' };
    const result = validateSubmissionPayload({
      agentId: card.agentId,
      cardDocument: tampered,
      endpointManifest: manifest,
      signatureBundle: bundle,
      organization: {
        organizationId: 'org-1',
        name: 'Org',
        contactEmail: 'ops@example.com',
        operatorPublicKey: bundle.publicKeyPem
      }
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(',')).toContain('signature');
    }
  });

  it('rejects payload when manifest lacks paths', () => {
    const card = buildValidCard();
    const { bundle } = signCard(card);
    const manifest = { openapi: '3.1.0' };
    const result = validateSubmissionPayload({
      agentId: card.agentId,
      cardDocument: card,
      endpointManifest: manifest,
      signatureBundle: bundle,
      organization: {
        organizationId: 'org-1',
        name: 'Org',
        contactEmail: 'ops@example.com',
        operatorPublicKey: bundle.publicKeyPem
      }
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('manifest.paths must include at least one path');
    }
  });
});
