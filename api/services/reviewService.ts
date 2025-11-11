import { getWorkflowProgress as fetchProgress, sendHumanDecision, sendRetrySignal, sendJudgeLlmOverride } from '../temporal/client';
import { StageName, LlmJudgeOverride } from '../types/reviewTypes';
import path from 'path';
import { promises as fs } from 'fs';

export async function getWorkflowProgress(submissionId: string) {
  return fetchProgress(submissionId);
}

export async function requestStageRetry(submissionId: string, stage: StageName, reason: string, options?: { llmOverride?: LlmJudgeOverride }): Promise<void> {
  if (stage === 'judge' && options?.llmOverride) {
    await sendJudgeLlmOverride(submissionId, options.llmOverride);
  }
  await sendRetrySignal(submissionId, stage, reason);
}

export async function requestHumanDecision(submissionId: string, decision: 'approved' | 'rejected', notes?: string): Promise<void> {
  await sendHumanDecision(submissionId, decision, notes);
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');

type LedgerEntry = {
  stage: StageName;
  entryPath?: string;
  digest?: string;
  workflowId?: string;
  workflowRunId?: string;
  generatedAt?: string;
  downloadUrl?: string;
  sourceFile?: string;
};

export type LedgerFileHandle = {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
};

export async function getLedgerSummary(submissionId: string): Promise<LedgerEntry[]> {
  const progress = await fetchProgress(submissionId);
  if (!progress) {
    return [];
  }
  const entries: LedgerEntry[] = [];
  for (const [stage, info] of Object.entries(progress.stages ?? {}) as Array<[StageName, any]>) {
    const ledger = info?.details?.ledger;
    if (ledger?.entryPath || ledger?.digest) {
      const { metadata, relativePath } = await readLedgerMetadata(ledger.entryPath);
      entries.push({
        stage,
        entryPath: ledger.entryPath,
        digest: ledger.digest,
        workflowId: metadata?.workflowId,
        workflowRunId: metadata?.runId,
        generatedAt: metadata?.exportedAt ?? metadata?.generatedAt,
        sourceFile: relativePath,
        downloadUrl: ledger.entryPath && !isRemotePath(ledger.entryPath)
          ? `/review/ledger/download?submissionId=${submissionId}&stage=${stage}`
          : ledger.entryPath
      });
    }
  }
  return entries;
}

export async function getLedgerEntryFile(submissionId: string, stage: StageName, options?: { progress?: any }): Promise<LedgerFileHandle | undefined> {
  const progress = options?.progress ?? await fetchProgress(submissionId);
  if (!progress) {
    return undefined;
  }
  const ledger = progress.stages?.[stage]?.details?.ledger;
  if (!ledger?.entryPath || isRemotePath(ledger.entryPath)) {
    return undefined;
  }
  const resolved = path.resolve(ledger.entryPath);
  if (!resolved.startsWith(REPO_ROOT)) {
    return undefined;
  }
  const relativePath = path.relative(REPO_ROOT, resolved);
  try {
    await fs.access(resolved);
    return { absolutePath: resolved, relativePath, exists: true };
  } catch {
    return { absolutePath: resolved, relativePath, exists: false };
  }
}

function isRemotePath(entryPath?: string): boolean {
  return !!entryPath && /^https?:\/\//i.test(entryPath);
}

async function readLedgerMetadata(entryPath?: string): Promise<{ metadata?: Record<string, any>; relativePath?: string }> {
  if (!entryPath || isRemotePath(entryPath)) {
    return {};
  }
  const resolved = path.resolve(entryPath);
  if (!resolved.startsWith(REPO_ROOT)) {
    return {};
  }
  try {
    const raw = await fs.readFile(resolved, 'utf8');
    return {
      metadata: JSON.parse(raw),
      relativePath: path.relative(REPO_ROOT, resolved)
    };
  } catch {
    return {};
  }
}
