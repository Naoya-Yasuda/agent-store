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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(entry: AuditLedgerEntry, options: { endpoint: string; token?: string }): Promise<void> {
  const maxAttempts = 3;
  let delayMs = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: JSON.stringify(entry)
    });

    if (response.ok) {
      return;
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
      throw new Error(`Failed to POST ledger entry: ${response.status} ${response.statusText}`);
    }

    await sleep(delayMs);
    delayMs *= 2;
  }
}

export async function publishToLedger(entry: AuditLedgerEntry, options?: PublishOptions): Promise<string> {
  const dir = options?.outputDir ?? path.join(process.cwd(), 'audit-ledger');
  await mkdir(dir, { recursive: true });
  const filename = `${entry.workflowId}-${entry.runId ?? 'latest'}-${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');

  if (options?.httpEndpoint) {
    await postWithRetry(entry, { endpoint: options.httpEndpoint, token: options.httpToken });
  }

  return filePath;
}
