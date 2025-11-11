import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { recordSecurityLedger } from '../activities/index';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

describe('recordSecurityLedger', () => {
  it('creates a ledger entry with digest', async () => {
    const workDir = await createTempDir('ledger-test-');
    const summaryPath = path.join(workDir, 'security_summary.json');
    const reportPath = path.join(workDir, 'security_report.jsonl');
    const promptsPath = path.join(workDir, 'security_prompts.jsonl');
    const ledgerDir = path.join(workDir, 'ledger');

    await fs.writeFile(summaryPath, JSON.stringify({ categories: { blocked: 1 }, generatedAt: 123 }), 'utf8');
    await fs.writeFile(reportPath, 'report', 'utf8');
    await fs.writeFile(promptsPath, 'prompt', 'utf8');

    process.env.SECURITY_LEDGER_DIR = ledgerDir;
    delete process.env.SECURITY_LEDGER_ENDPOINT;
    delete process.env.SECURITY_LEDGER_TOKEN;

    const result = await recordSecurityLedger({
      workflowId: 'wf-id',
      workflowRunId: 'run-id',
      submissionId: 'sub-1',
      agentId: 'agent-1',
      agentRevisionId: 'rev-1',
      summaryPath,
      reportPath,
      promptsPath,
      summary: { categories: { blocked: 1 }, generatedAt: 123 }
    });

    expect(result.digest).toBeTruthy();
    expect(result.entryPath).toBeTruthy();
    const ledgerContent = JSON.parse(await fs.readFile(result.entryPath!, 'utf8'));
    expect(ledgerContent.workflowId).toBe('wf-id');
    expect(ledgerContent.historyDigestSha256).toBe(result.digest);
    const files = await fs.readdir(ledgerDir);
    expect(files.length).toBeGreaterThan(0);
  });
});
