import { getWorkflowProgress as fetchProgress, sendHumanDecision, sendRetrySignal } from '../temporal/client';
import { StageName } from '../types/reviewTypes';

export async function getWorkflowProgress(submissionId: string) {
  return fetchProgress(submissionId);
}

export async function requestStageRetry(submissionId: string, stage: string, reason: string): Promise<void> {
  await sendRetrySignal(submissionId, stage, reason);
}

export async function requestHumanDecision(submissionId: string, decision: 'approved' | 'rejected', notes?: string): Promise<void> {
  await sendHumanDecision(submissionId, decision, notes);
}

export async function getLedgerSummary(submissionId: string): Promise<Array<{ stage: StageName; entryPath?: string; digest?: string }>> {
  const progress = await fetchProgress(submissionId);
  if (!progress) {
    return [];
  }
  const entries: Array<{ stage: StageName; entryPath?: string; digest?: string }> = [];
  for (const [stage, info] of Object.entries(progress.stages ?? {}) as Array<[StageName, any]>) {
    const ledger = info?.details?.ledger;
    if (ledger?.entryPath || ledger?.digest) {
      entries.push({ stage, entryPath: ledger.entryPath, digest: ledger.digest });
    }
  }
  return entries;
}
