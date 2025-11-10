import { AgentCard } from '../../prototype/temporal-review-workflow/src/types/agentCard';
import { checkManifestAgainstCard, EndpointManifest } from './manifestConsistency';
import { SignatureBundle, verifySignatureBundle } from './signatureVerifier';
import { validateAgentCardPayload } from './agentCardValidator';

export interface OrganizationMeta {
  organizationId: string;
  name: string;
  contactEmail: string;
  operatorPublicKey: string;
}

export interface SubmissionPayload {
  agentId: string;
  cardDocument: AgentCard;
  endpointManifest: EndpointManifest;
  signatureBundle: SignatureBundle;
  organization: OrganizationMeta;
}

export interface SubmissionValidationSuccess {
  valid: true;
  payload: SubmissionPayload;
  manifestWarnings: string[];
}

export interface SubmissionValidationFailure {
  valid: false;
  errors: string[];
}

export type SubmissionValidationResult = SubmissionValidationSuccess | SubmissionValidationFailure;

export function validateSubmissionPayload(input: unknown): SubmissionValidationResult {
  if (typeof input !== 'object' || input === null) {
    return invalid(['payload must be an object']);
  }
  const payload = input as Record<string, unknown>;

  const agentId = payload.agentId;
  if (typeof agentId !== 'string') {
    return invalid(['agentId must be a string']);
  }

  const cardDocument = payload.cardDocument as AgentCard | undefined;
  if (!cardDocument) {
    return invalid(['cardDocument is required']);
  }
  const cardValidation = validateAgentCardPayload(cardDocument);
  if (!cardValidation.valid) {
    return invalid(cardValidation.errors ?? ['cardDocument is invalid']);
  }
  if (cardDocument.agentId !== agentId) {
    return invalid(['agentId must match cardDocument.agentId']);
  }

  const signatureBundle = payload.signatureBundle as SignatureBundle | undefined;
  if (!signatureBundle) {
    return invalid(['signatureBundle is required']);
  }
  if (!signatureBundle.algorithm || !signatureBundle.publicKeyPem || !signatureBundle.signature || !signatureBundle.payloadDigest) {
    return invalid(['signatureBundle is missing required fields']);
  }
  const signatureResult = verifySignatureBundle(signatureBundle, cardDocument);
  if (!signatureResult.valid) {
    return invalid([`signature invalid: ${signatureResult.error ?? 'unknown_error'}`]);
  }

  const endpointManifest = payload.endpointManifest as EndpointManifest | undefined;
  if (!endpointManifest) {
    return invalid(['endpointManifest is required']);
  }
  const manifestResult = checkManifestAgainstCard(endpointManifest, cardDocument);
  if (!manifestResult.valid) {
    return invalid(manifestResult.errors ?? ['endpointManifest is invalid']);
  }

  const organization = payload.organization as OrganizationMeta | undefined;
  if (!organization) {
    return invalid(['organization is required']);
  }
  if (!organization.organizationId || !organization.name || !organization.contactEmail || !organization.operatorPublicKey) {
    return invalid(['organization is missing required fields']);
  }

  return {
    valid: true,
    payload: {
      agentId,
      cardDocument,
      endpointManifest,
      signatureBundle,
      organization
    },
    manifestWarnings: manifestResult.warnings ?? []
  };
}

function invalid(errors: string[]): SubmissionValidationFailure {
  return { valid: false, errors };
}
