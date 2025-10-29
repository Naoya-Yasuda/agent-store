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

export async function publishToLedger(entry: AuditLedgerEntry, options?: { outputDir?: string }): Promise<string> {
  const dir = options?.outputDir ?? path.join(process.cwd(), 'audit-ledger');
  await mkdir(dir, { recursive: true });
  const filename = `${entry.workflowId}-${entry.runId ?? 'latest'}-${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');
  return filePath;
}
