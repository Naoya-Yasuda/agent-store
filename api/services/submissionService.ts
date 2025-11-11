import { SubmissionPayload } from '../utils/submissionValidator';
import { insertSubmission, SubmissionRecord } from '../repositories/submissionRepository';
import { startReviewWorkflow } from '../temporal/client';
import path from 'path';
import { promises as fs } from 'fs';

export interface SubmissionRequestContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export async function createSubmission(payload: SubmissionPayload, manifestWarnings: string[], requestContext: SubmissionRequestContext): Promise<SubmissionRecord> {
  const record = await insertSubmission(payload, manifestWarnings, requestContext);
  const wandbRun = payload.telemetry?.wandb;
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
            url: wandbRun.baseUrl && wandbRun.runId && wandbRun.project && wandbRun.entity
              ? `${wandbRun.baseUrl.replace(/\/$/, '')}/${wandbRun.entity}/${wandbRun.project}/runs/${wandbRun.runId}`
              : undefined
          }
        : undefined
    });
  } catch (err) {
    console.error('[submissionService] failed to start workflow', err);
  }
  return record;
}

const SANDBOX_ARTIFACTS_DIR = path.resolve(__dirname, '..', '..', 'sandbox-runner', 'artifacts');

async function persistAgentCard(artifactKey: string, card: SubmissionPayload['cardDocument']): Promise<string> {
  const dir = path.join(SANDBOX_ARTIFACTS_DIR, artifactKey);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'agent_card.json');
  await fs.writeFile(filePath, JSON.stringify(card, null, 2), 'utf8');
  return filePath;
}
