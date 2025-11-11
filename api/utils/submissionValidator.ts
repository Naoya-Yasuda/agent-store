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

export interface WandbTelemetry {
  runId?: string;
  project?: string;
  entity?: string;
  baseUrl?: string;
}

export interface SubmissionTelemetry {
  wandb?: WandbTelemetry;
  relay?: {
    endpoint?: string;
    token?: string;
  };
  llmJudge?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    baseUrl?: string;
    dryRun?: boolean;
  };
}

export interface SubmissionPayload {
  agentId: string;
  cardDocument: AgentCard;
  endpointManifest: EndpointManifest;
  signatureBundle: SignatureBundle;
  organization: OrganizationMeta;
  telemetry?: SubmissionTelemetry;
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

  const telemetry = payload.telemetry as SubmissionTelemetry | undefined;
  if (telemetry?.wandb) {
    const { runId, project, entity, baseUrl } = telemetry.wandb;
    if (runId && typeof runId !== 'string') {
      return invalid(['telemetry.wandb.runId must be a string']);
    }
    if (project && typeof project !== 'string') {
      return invalid(['telemetry.wandb.project must be a string']);
    }
    if (entity && typeof entity !== 'string') {
      return invalid(['telemetry.wandb.entity must be a string']);
    }
    if (baseUrl && typeof baseUrl !== 'string') {
      return invalid(['telemetry.wandb.baseUrl must be a string']);
    }
  }
  if (telemetry?.relay) {
    const { endpoint, token } = telemetry.relay;
    if (endpoint && typeof endpoint !== 'string') {
      return invalid(['telemetry.relay.endpoint must be a string']);
    }
    if (token && typeof token !== 'string') {
      return invalid(['telemetry.relay.token must be a string']);
    }
  }
  if (telemetry?.llmJudge) {
    const { enabled, provider, model, temperature, maxOutputTokens, baseUrl, dryRun } = telemetry.llmJudge;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return invalid(['telemetry.llmJudge.enabled must be a boolean']);
    }
    if (provider && typeof provider !== 'string') {
      return invalid(['telemetry.llmJudge.provider must be a string']);
    }
    if (model && typeof model !== 'string') {
      return invalid(['telemetry.llmJudge.model must be a string']);
    }
    if (temperature !== undefined && typeof temperature !== 'number') {
      return invalid(['telemetry.llmJudge.temperature must be a number']);
    }
    if (maxOutputTokens !== undefined && typeof maxOutputTokens !== 'number') {
      return invalid(['telemetry.llmJudge.maxOutputTokens must be a number']);
    }
    if (baseUrl && typeof baseUrl !== 'string') {
      return invalid(['telemetry.llmJudge.baseUrl must be a string']);
    }
    if (dryRun !== undefined && typeof dryRun !== 'boolean') {
      return invalid(['telemetry.llmJudge.dryRun must be a boolean']);
    }
  }

  return {
    valid: true,
    payload: {
      agentId,
      cardDocument,
      endpointManifest,
      signatureBundle,
      organization,
      telemetry
    },
    manifestWarnings: manifestResult.warnings ?? []
  };
}

function invalid(errors: string[]): SubmissionValidationFailure {
  return { valid: false, errors };
}
