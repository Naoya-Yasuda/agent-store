import { SubmissionPayload, WandbTelemetry } from '../utils/submissionValidator';
import { insertSubmission, SubmissionRecord } from '../repositories/submissionRepository';
import { startReviewWorkflow } from '../temporal/client';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID, createHash } from 'crypto';
import { stableStringify } from '../utils/json';
import pool from '../db/pool';

export type SubmissionRequestContext = Record<string, string | undefined> & {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export async function createSubmission(payload: SubmissionPayload, manifestWarnings: string[], requestContext: SubmissionRequestContext): Promise<SubmissionRecord> {
  // Check for duplicate endpoint
  const snapshotHash = createHash('sha256').update(stableStringify(payload.endpointManifest)).digest('hex');
  const duplicateCheck = await pool.query(
    'SELECT id, state, created_at FROM submissions WHERE endpoint_snapshot_hash = $1 ORDER BY created_at DESC LIMIT 1',
    [snapshotHash]
  );

  if (duplicateCheck.rows.length > 0) {
    const existing = duplicateCheck.rows[0];
    throw new Error(`This endpoint URL has already been registered (Submission ID: ${existing.id}, State: ${existing.state})`);
  }

  const wandbRun = ensureWandbConfig(payload.telemetry?.wandb);
  const record = await insertSubmission(payload, manifestWarnings, requestContext, wandbRun);
  const relay = payload.telemetry?.relay;
  const artifactKey = payload.cardDocument.id || record.id;
  const agentCardPath = await persistAgentCard(artifactKey, payload.cardDocument);
  try {
    await startReviewWorkflow({
      submissionId: record.id,
      promptVersion: payload.cardDocument?.id ?? 'default-prompt',
      agentId: payload.cardDocument.agentId,
      agentRevisionId: payload.cardDocument.id,
      agentCardPath,
      relay,
      llmJudge: payload.telemetry?.llmJudge,
      wandbRun: wandbRun
        ? {
            ...wandbRun,
            url: buildWandbUrl(wandbRun)
          }
        : undefined
    });
  } catch (err) {
    console.error('[submissionService] failed to start workflow', err);
  }
  return record;
}

const DEFAULT_WANDB_PROJECT = process.env.WANDB_DEFAULT_PROJECT ?? 'agent-store-sandbox';
const DEFAULT_WANDB_ENTITY = process.env.WANDB_DEFAULT_ENTITY ?? 'local';
const DEFAULT_WANDB_BASE_URL = process.env.WANDB_DEFAULT_BASE_URL ?? 'https://wandb.ai';

function ensureWandbConfig(config?: WandbTelemetry | null): WandbTelemetry {
  return {
    runId: config?.runId ?? `submission-${randomUUID()}`,
    project: config?.project ?? DEFAULT_WANDB_PROJECT,
    entity: config?.entity ?? DEFAULT_WANDB_ENTITY,
    baseUrl: config?.baseUrl ?? DEFAULT_WANDB_BASE_URL
  };
}

function buildWandbUrl(config: WandbTelemetry | undefined): string | undefined {
  if (!config?.runId || !config.project || !config.entity || !config.baseUrl) {
    return undefined;
  }
  return `${config.baseUrl.replace(/\/$/, '')}/${config.entity}/${config.project}/runs/${config.runId}`;
}

const SANDBOX_ARTIFACTS_DIR = path.resolve(__dirname, '..', '..', 'sandbox-runner', 'artifacts');

async function persistAgentCard(artifactKey: string, card: SubmissionPayload['cardDocument']): Promise<string> {
  const dir = path.join(SANDBOX_ARTIFACTS_DIR, artifactKey);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'agent_card.json');
  await fs.writeFile(filePath, JSON.stringify(card, null, 2), 'utf8');
  return filePath;
}
