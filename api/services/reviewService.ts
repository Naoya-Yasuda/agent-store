import { getWorkflowProgress as fetchProgress, sendHumanDecision, sendRetrySignal } from '../temporal/client';

export async function getWorkflowProgress(submissionId: string) {
  return fetchProgress(submissionId);
}

export async function requestStageRetry(submissionId: string, stage: string, reason: string): Promise<void> {
  await sendRetrySignal(submissionId, stage, reason);
}

export async function requestHumanDecision(submissionId: string, decision: 'approved' | 'rejected', notes?: string): Promise<void> {
  await sendHumanDecision(submissionId, decision, notes);
}
