import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export interface AuditLedgerEntry {
  workflowId: string;
  runId: string | null;
  namespace: string;
  historyDigestSha256: string;
  exportedAt: string;
  sourceFile: string;
}

interface PublishOptions {
  outputDir?: string;
  httpEndpoint?: string;
  httpToken?: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface PostResult {
  success: boolean;
  attempts: number;
  lastError?: string;
}

export interface PublishResult {
  entryPath: string;
  httpPosted?: boolean;
  httpAttempts?: number;
  httpError?: string;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(entry: AuditLedgerEntry, options: { endpoint: string; token?: string }): Promise<PostResult> {
  const maxAttempts = 3;
  let delayMs = 1000;
  let lastError: string | undefined;
  let attemptsPerformed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsPerformed = attempt;
    try {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: JSON.stringify(entry)
      });

      if (response.ok) {
        return { success: true, attempts: attempt };
      }

      lastError = `Failed to POST ledger entry: ${response.status} ${response.statusText}`;
      if (!RETRYABLE_STATUS.has(response.status)) {
        return { success: false, attempts: attempt, lastError };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt === maxAttempts) {
      break;
    }

    await sleep(delayMs);
    delayMs *= 2;
  }

  return { success: false, attempts: attemptsPerformed || 1, lastError };
}

export async function publishToLedger(entry: AuditLedgerEntry, options?: PublishOptions): Promise<PublishResult> {
  const dir = options?.outputDir ?? path.join(process.cwd(), 'audit-ledger');
  await mkdir(dir, { recursive: true });
  const filename = `${entry.workflowId}-${entry.runId ?? 'latest'}-${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');

  let httpPosted: boolean | undefined;
  let httpAttempts: number | undefined;
  let httpError: string | undefined;
  if (options?.httpEndpoint) {
    const result = await postWithRetry(entry, { endpoint: options.httpEndpoint, token: options.httpToken });
    httpPosted = result.success;
    httpAttempts = result.attempts;
    if (!result.success && result.lastError) {
      httpError = result.lastError;
      console.warn('[auditLedger] ledger HTTP upload failed', result.lastError);
    }
  }

  return { entryPath: filePath, httpPosted, httpAttempts, httpError };
}
