import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { recordSecurityLedger, recordJudgeLedger, recordStageEvent } from '../activities/index';
import { getLedgerEntryFile } from '../../../../api/services/reviewService';

vi.mock('../../../../api/temporal/client', () => ({
  getWorkflowProgress: vi.fn(),
  sendHumanDecision: vi.fn(),
  sendRetrySignal: vi.fn(),
  sendJudgeLlmOverride: vi.fn()
}));

const tmpDirs: string[] = [];
const artifactDirs: string[] = [];
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const PRIMARY_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'sandbox-runner', 'artifacts');
const LEGACY_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'prototype', 'sandbox-runner', 'artifacts');
const ARTIFACT_BASES = [PRIMARY_ARTIFACTS_DIR, LEGACY_ARTIFACTS_DIR];

afterEach(async () => {
  delete process.env.SECURITY_LEDGER_DIR;
  delete process.env.SECURITY_LEDGER_ENDPOINT;
  delete process.env.SECURITY_LEDGER_TOKEN;
  delete process.env.JUDGE_LEDGER_DIR;
  delete process.env.JUDGE_LEDGER_ENDPOINT;
  delete process.env.JUDGE_LEDGER_TOKEN;
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  while (artifactDirs.length) {
    const dir = artifactDirs.pop();
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

async function seedMetadataFiles(revision: string): Promise<string[]> {
  const metadataPaths: string[] = [];
  for (const base of ARTIFACT_BASES) {
    const revisionDir = path.join(base, revision);
    await fs.mkdir(revisionDir, { recursive: true });
    artifactDirs.push(revisionDir);
    const metadataPath = path.join(revisionDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify({ stageDetails: { judge: {} }, wandbMcp: {} }), 'utf8');
    metadataPaths.push(metadataPath);
  }
  return metadataPaths;
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

describe('recordJudgeLedger', () => {
  it('creates a ledger entry with LLM metadata', async () => {
    const workDir = await createTempDir('judge-ledger-');
    const summaryPath = path.join(workDir, 'judge_summary.json');
    const reportPath = path.join(workDir, 'judge_report.jsonl');
    const relayLogPath = path.join(workDir, 'relay_logs.jsonl');
    const ledgerDir = path.join(workDir, 'judge-ledger');

    await fs.writeFile(summaryPath, JSON.stringify({ approved: 2, manual: 1, rejected: 0, llmJudge: { enabled: true, model: 'gpt-4o' } }), 'utf8');
    await fs.writeFile(reportPath, 'judge report', 'utf8');
    await fs.writeFile(relayLogPath, 'relay log', 'utf8');

    process.env.JUDGE_LEDGER_DIR = ledgerDir;
    delete process.env.JUDGE_LEDGER_ENDPOINT;
    delete process.env.JUDGE_LEDGER_TOKEN;

    const result = await recordJudgeLedger({
      workflowId: 'wf-judge',
      workflowRunId: 'run-judge',
      submissionId: 'submission-1',
      agentId: 'agent-judge',
      agentRevisionId: 'rev-judge',
      summaryPath,
      reportPath,
      relayLogPath,
      summary: { approved: 2, manual: 1, rejected: 0, llmJudge: { enabled: true, model: 'gpt-4o' } }
    });

    expect(result.digest).toBeTruthy();
    expect(result.entryPath).toBeTruthy();
    const ledgerContent = JSON.parse(await fs.readFile(result.entryPath!, 'utf8'));
    expect(ledgerContent.workflowId).toBe('wf-judge');
    expect(ledgerContent.historyDigestSha256).toBe(result.digest);
    const files = await fs.readdir(ledgerDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('recordStageEvent', () => {
  it('persists lastEvent and metadata timeline', async () => {
    const revision = `rev-stage-${Date.now()}`;
    const metadataPaths = await seedMetadataFiles(revision);

    await recordStageEvent({
      agentRevisionId: revision,
      stage: 'judge',
      event: 'manual_verdict',
      data: { explanation: 'needs review' },
      timestamp: '2025-11-11T00:00:00Z'
    });

    let updatedMetadata: any | undefined;
    for (const metadataPath of metadataPaths) {
      try {
        const parsed = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        if (parsed?.stageDetails?.judge?.lastEvent) {
          updatedMetadata = parsed;
          break;
        }
      } catch {
        // ignore
      }
    }

    expect(updatedMetadata).toBeDefined();
    expect(updatedMetadata!.stageDetails?.judge?.lastEvent?.event).toBe('manual_verdict');
    expect(updatedMetadata!.stageDetails?.judge?.lastEvent?.timestamp).toBe('2025-11-11T00:00:00Z');
    expect(Array.isArray(updatedMetadata!.wandbMcp?.events)).toBe(true);
    expect(updatedMetadata!.wandbMcp.events[0].stage).toBe('judge');
    expect(updatedMetadata!.wandbMcp.events[0].event).toBe('manual_verdict');
  });
});

describe('getLedgerEntryFile', () => {
  it('returns local ledger file handles when file exists', async () => {
    const revisionDir = path.join(PRIMARY_ARTIFACTS_DIR, `ledger-download-${Date.now()}`);
    artifactDirs.push(revisionDir);
    await fs.mkdir(revisionDir, { recursive: true });
    const ledgerFile = path.join(revisionDir, 'security_ledger_entry.json');
    await fs.writeFile(ledgerFile, JSON.stringify({ ok: true }), 'utf8');

    const progress = {
      stages: {
        security: {
          details: {
            ledger: { entryPath: ledgerFile, digest: 'abc' }
          }
        }
      }
    };

    const result = await getLedgerEntryFile('subm-test', 'security', { progress });
    expect(result?.absolutePath).toBe(ledgerFile);
    expect(result?.exists).toBe(true);
    expect(result?.relativePath).toContain('security_ledger_entry.json');
  });

  it('marks ledger file as missing when path cannot be accessed', async () => {
    const revisionDir = path.join(PRIMARY_ARTIFACTS_DIR, `ledger-missing-${Date.now()}`);
    artifactDirs.push(revisionDir);
    await fs.mkdir(revisionDir, { recursive: true });
    const ledgerFile = path.join(revisionDir, 'missing_security_ledger.json');

    const progress = {
      stages: {
        security: {
          details: {
            ledger: { entryPath: ledgerFile, digest: 'abc' }
          }
        }
      }
    };

    const result = await getLedgerEntryFile('subm-test', 'security', { progress });
    expect(result).toBeDefined();
    expect(result?.exists).toBe(false);
    expect(result?.relativePath).toContain('missing_security_ledger.json');
  });
});
