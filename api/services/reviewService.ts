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
const SANDBOX_ARTIFACTS_DIR = path.join(REPO_ROOT, 'sandbox-runner', 'artifacts');

type LedgerEntry = {
  stage: StageName;
  entryPath?: string;
  digest?: string;
  workflowId?: string;
  workflowRunId?: string;
  generatedAt?: string;
  downloadUrl?: string;
  sourceFile?: string;
  httpPosted?: boolean;
  httpAttempts?: number;
  httpError?: string;
};

export type LedgerFileHandle = {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  fallback?: boolean;
};

export type StageEventRecord = {
  id: string;
  stage: string;
  event: string;
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
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
      const resolvedSource = ledger.sourceFile && ledger.sourceFile.startsWith(REPO_ROOT)
        ? ledger.sourceFile
        : undefined;
      const sourceRelative = resolvedSource ? path.relative(REPO_ROOT, resolvedSource) : relativePath;
      entries.push({
        stage,
        entryPath: ledger.entryPath,
        digest: ledger.digest,
        workflowId: metadata?.workflowId,
        workflowRunId: metadata?.runId,
        generatedAt: metadata?.exportedAt ?? metadata?.generatedAt,
        sourceFile: sourceRelative,
        httpPosted: ledger.httpPosted,
        httpAttempts: ledger.httpAttempts,
        httpError: ledger.httpError,
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
    const fallbackResolved = ledger.sourceFile && ledger.sourceFile.startsWith(REPO_ROOT)
      ? ledger.sourceFile
      : undefined;
    if (fallbackResolved) {
      try {
        await fs.access(fallbackResolved);
        return {
          absolutePath: fallbackResolved,
          relativePath: path.relative(REPO_ROOT, fallbackResolved),
          exists: true,
          fallback: true
        };
      } catch {
        return {
          absolutePath: fallbackResolved,
          relativePath: path.relative(REPO_ROOT, fallbackResolved),
          exists: false,
          fallback: true
        };
      }
    }
    return { absolutePath: resolved, relativePath, exists: false };
  }
}

function isRemotePath(entryPath?: string): boolean {
  return !!entryPath && /^https?:\/\//i.test(entryPath);
}

function resolveRepoPath(target?: string): string | undefined {
  if (!target) {
    return undefined;
  }
  const resolved = path.resolve(REPO_ROOT, target);
  if (!resolved.startsWith(REPO_ROOT)) {
    return undefined;
  }
  return resolved;
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

async function readMetadata(agentRevisionId: string): Promise<any | undefined> {
  const metadataPath = path.join(SANDBOX_ARTIFACTS_DIR, agentRevisionId, 'metadata.json');
  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[reviewService] failed to read metadata', err);
    }
    return undefined;
  }
}

export async function getStageEvents(submissionId: string): Promise<{ events: StageEventRecord[]; agentRevisionId?: string } | undefined> {
  const progress = await fetchProgress(submissionId);
  if (!progress?.agentRevisionId) {
    return progress ? { events: [], agentRevisionId: undefined } : undefined;
  }
  const metadata = await readMetadata(progress.agentRevisionId);
  const rawEvents: any[] = Array.isArray(metadata?.wandbMcp?.events) ? metadata.wandbMcp.events : [];
  const events: StageEventRecord[] = rawEvents.map((event, index) => ({
    id: String(event?.id ?? `event-${index}`),
    stage: String(event?.stage ?? 'unknown'),
    event: String(event?.event ?? event?.type ?? 'unknown'),
    type: event?.type ? String(event.type) : undefined,
    timestamp: event?.timestamp ? String(event.timestamp) : undefined,
    data: typeof event?.data === 'object' && event?.data !== null ? event.data : undefined
  }));
  events.sort((a, b) => {
    const at = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bt - at;
  });
  return { events, agentRevisionId: progress.agentRevisionId };
}
