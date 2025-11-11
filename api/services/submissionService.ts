import { SubmissionPayload } from '../utils/submissionValidator';
import { insertSubmission, SubmissionRecord } from '../repositories/submissionRepository';
import { startReviewWorkflow } from '../temporal/client';

export interface SubmissionRequestContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export async function createSubmission(payload: SubmissionPayload, manifestWarnings: string[], requestContext: SubmissionRequestContext): Promise<SubmissionRecord> {
  const record = await insertSubmission(payload, manifestWarnings, requestContext);
  const wandbRun = payload.telemetry?.wandb;
  try {
    await startReviewWorkflow({
      submissionId: record.id,
      promptVersion: payload.cardDocument?.id ?? 'default-prompt',
      agentId: payload.cardDocument.agentId,
      agentRevisionId: payload.cardDocument.id,
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
