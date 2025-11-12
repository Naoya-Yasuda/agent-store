import { getWorkflowProgress as fetchProgress, sendHumanDecision, sendRetrySignal, sendJudgeLlmOverride } from '../temporal/client';
import { StageName, LlmJudgeOverride } from '../types/reviewTypes';
import path from 'path';
import { promises as fs } from 'fs';
import http from 'http';
import https from 'https';
import { URL } from 'url';

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
const LEDGER_CACHE_DIR = path.join(SANDBOX_ARTIFACTS_DIR, '__ledger-cache__');
const LEDGER_REMOTE_TIMEOUT_MS = Number(process.env.LEDGER_REMOTE_TIMEOUT_MS ?? 8000);
const LEDGER_REMOTE_MAX_BYTES = Number(process.env.LEDGER_REMOTE_MAX_BYTES ?? 5 * 1024 * 1024);

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
  downloadAvailable?: boolean;
  downloadRelativePath?: string;
  downloadFallback?: boolean;
  downloadStatus?: 'primary' | 'fallback' | 'remote';
  downloadMissingReason?: 'primary_missing' | 'fallback_missing' | 'remote_unreachable';
  remoteStatusCode?: number;
  remoteLatencyMs?: number;
  remoteReachable?: boolean;
  remoteError?: string;
};

export type LedgerFileHandle = {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  fallback?: boolean;
  status?: 'primary' | 'fallback' | 'remote';
  missingReason?: 'primary_missing' | 'fallback_missing' | 'remote_unreachable';
  remoteUrl?: string;
  remoteStatusCode?: number;
  remoteFetchedAt?: string;
  remoteError?: string;
};

export type StageEventRecord = {
  id: string;
  stage: string;
  event: string;
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  severity?: string;
};

export async function getLedgerSummary(submissionId: string, options?: { progress?: any }): Promise<LedgerEntry[]> {
  const progress = options?.progress ?? await fetchProgress(submissionId);
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
      const downloadHandle = await getLedgerEntryFile(submissionId, stage, { progress });
      const remoteHealth = ledger.entryPath && isRemotePath(ledger.entryPath)
        ? await probeRemoteLedger(ledger.entryPath)
        : undefined;
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
        downloadAvailable: downloadHandle?.exists,
        downloadRelativePath: downloadHandle?.relativePath,
        downloadFallback: downloadHandle?.fallback,
        downloadStatus: downloadHandle?.status,
        downloadMissingReason: downloadHandle?.missingReason,
        downloadUrl: ledger.entryPath && !isRemotePath(ledger.entryPath)
          ? `/review/ledger/download?submissionId=${submissionId}&stage=${stage}`
          : ledger.entryPath,
        remoteStatusCode: remoteHealth?.statusCode,
        remoteLatencyMs: remoteHealth?.latencyMs,
        remoteReachable: remoteHealth?.reachable,
        remoteError: remoteHealth?.error
      });
    }
  }
  return entries;
}

export async function getLedgerEntryFile(submissionId: string, stage: StageName, options?: { progress?: any; allowRemote?: boolean }): Promise<LedgerFileHandle | undefined> {
  const progress = options?.progress ?? await fetchProgress(submissionId);
  if (!progress) {
    return undefined;
  }
  const ledger = progress.stages?.[stage]?.details?.ledger;
  const allowRemote = options?.allowRemote ?? false;
  if (!ledger?.entryPath) {
    return undefined;
  }
  if (isRemotePath(ledger.entryPath)) {
    if (!allowRemote) {
      return undefined;
    }
    return downloadRemoteLedger(submissionId, stage, ledger.entryPath, progress.agentRevisionId);
  }
  const resolved = path.resolve(ledger.entryPath);
  if (!resolved.startsWith(REPO_ROOT)) {
    return undefined;
  }
  const relativePath = path.relative(REPO_ROOT, resolved);
  try {
    await fs.access(resolved);
    return { absolutePath: resolved, relativePath, exists: true, status: 'primary' };
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
          fallback: true,
          status: 'fallback'
        };
      } catch {
        return {
          absolutePath: fallbackResolved,
          relativePath: path.relative(REPO_ROOT, fallbackResolved),
          exists: false,
          fallback: true,
          status: 'fallback',
          missingReason: 'fallback_missing'
        };
      }
    }
    return { absolutePath: resolved, relativePath, exists: false, status: 'primary', missingReason: 'primary_missing' };
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

type HttpRequestArgs = {
  method?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  maxBytes?: number;
};

async function downloadRemoteLedger(submissionId: string, stage: StageName, url: string, agentRevisionId?: string): Promise<LedgerFileHandle> {
  const cacheRoot = agentRevisionId ?? submissionId;
  const cacheDir = path.join(LEDGER_CACHE_DIR, cacheRoot);
  const cachePath = path.join(cacheDir, `${stage}-remote.json`);
  const relativePath = path.relative(REPO_ROOT, cachePath);
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const response = await httpRequestRaw(url, {
      method: 'GET',
      timeoutMs: LEDGER_REMOTE_TIMEOUT_MS,
      maxBytes: LEDGER_REMOTE_MAX_BYTES
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      await fs.writeFile(cachePath, response.body);
      return {
        absolutePath: cachePath,
        relativePath,
        exists: true,
        fallback: true,
        status: 'remote',
        remoteUrl: url,
        remoteStatusCode: response.statusCode,
        remoteFetchedAt: new Date().toISOString()
      };
    }
    return {
      absolutePath: cachePath,
      relativePath,
      exists: false,
      fallback: true,
      status: 'remote',
      missingReason: 'remote_unreachable',
      remoteUrl: url,
      remoteStatusCode: response.statusCode
    };
  } catch (err) {
    return {
      absolutePath: cachePath,
      relativePath,
      exists: false,
      fallback: true,
      status: 'remote',
      missingReason: 'remote_unreachable',
      remoteUrl: url,
      remoteError: err instanceof Error ? err.message : String(err)
    };
  }
}

async function probeRemoteLedger(url: string): Promise<{ reachable: boolean; statusCode?: number; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    let response = await httpRequestRaw(url, {
      method: 'HEAD',
      timeoutMs: Math.min(LEDGER_REMOTE_TIMEOUT_MS, 5000),
      maxBytes: 0
    });
    if (response.statusCode === 405 || response.statusCode === 501) {
      response = await httpRequestRaw(url, {
        method: 'GET',
        timeoutMs: Math.min(LEDGER_REMOTE_TIMEOUT_MS, 5000),
        headers: { Range: 'bytes=0-0' },
        maxBytes: 1
      });
    }
    return {
      reachable: response.statusCode >= 200 && response.statusCode < 400,
      statusCode: response.statusCode,
      latencyMs: Date.now() - start
    };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function httpRequestRaw(urlString: string, options: HttpRequestArgs = {}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlString);
    const client = parsed.protocol === 'https:' ? https : http;
    const requestOptions: http.RequestOptions = {
      method: options.method ?? 'GET',
      headers: options.headers,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`
    };
    const req = client.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;
      const maxBytes = typeof options.maxBytes === 'number' ? options.maxBytes : LEDGER_REMOTE_MAX_BYTES;
      res.on('data', (chunk: Buffer) => {
        if (maxBytes > 0) {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy(new Error('ledger_remote_response_too_large'));
            return;
          }
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
      res.on('error', reject);
    });
    req.setTimeout(options.timeoutMs ?? LEDGER_REMOTE_TIMEOUT_MS, () => {
      req.destroy(new Error('ledger_remote_timeout'));
    });
    req.on('error', reject);
    req.end();
  });
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
