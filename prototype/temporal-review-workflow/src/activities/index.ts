import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { WandbRunInfo, LlmJudgeConfig, StageName, TrustScoreBreakdown } from '../workflows/reviewPipeline.workflow';
import { publishToLedger, AuditLedgerEntry } from '../lib/auditLedger';
import { NAMESPACE } from '../../temporal.config';
import { getDbPool } from '../lib/dbPool';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const SANDBOX_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'sandbox-runner', 'artifacts');
const INSPECT_OUT_DIR = path.join(PROJECT_ROOT, 'prototype', 'inspect-worker', 'out');
const INSPECT_SCRIPT = path.join(PROJECT_ROOT, 'prototype', 'inspect-worker', 'scripts', 'run_eval.py');
const SANDBOX_PYTHON = process.env.SANDBOX_PYTHON ?? 'python3.13';
const INSPECT_PYTHON = process.env.INSPECT_PYTHON ?? 'python3.13';

async function ensureSandboxArtifacts(agentRevisionId: string): Promise<string> {
  await fs.mkdir(SANDBOX_ARTIFACTS_DIR, { recursive: true });
  // Remove -revN suffix to match where API stores agent_card.json
  const submissionId = agentRevisionId.replace(/-rev\d+$/, '');
  const stageDir = path.join(SANDBOX_ARTIFACTS_DIR, submissionId);
  await fs.mkdir(stageDir, { recursive: true });
  return stageDir;
}

async function readJsonFile<T = unknown>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[activities] failed to read ${filePath}`, err);
    }
    return undefined;
  }
}

function appendWandbCliArgs(cliArgs: string[], wandb?: WandbRunInfo): void {
  if (!wandb) {
    return;
  }
  if (wandb.runId) {
    cliArgs.push('--wandb-run-id', wandb.runId);
  }
  if (wandb.project) {
    cliArgs.push('--wandb-project', wandb.project);
  }
  if (wandb.entity) {
    cliArgs.push('--wandb-entity', wandb.entity);
  }
  if (wandb.baseUrl) {
    cliArgs.push('--wandb-base-url', wandb.baseUrl);
  }
}

function extractWandbFromMetadata(metadata?: any): WandbRunInfo | undefined {
  if (!metadata) {
    return undefined;
  }
  const preferred = metadata.wandbMcp ?? metadata.wandb;
  if (!preferred) {
    return undefined;
  }
  return {
    runId: preferred.runId ?? metadata.wandb?.runId,
    project: preferred.project ?? metadata.wandb?.project,
    entity: preferred.entity ?? metadata.wandb?.entity,
    baseUrl: metadata.wandb?.baseUrl,
    url: preferred.url ?? metadata.wandb?.url
  };
}

async function resolveWandbInfo(agentRevisionId: string): Promise<WandbRunInfo | undefined> {
  const metadataPath = path.join(SANDBOX_ARTIFACTS_DIR, agentRevisionId, 'metadata.json');
  const metadata = await readJsonFile(metadataPath);
  return extractWandbFromMetadata(metadata);
}

// Helper function to update submission state in database (internal use)
async function updateSubmissionStateInternal(submissionId: string, state: string): Promise<void> {
  const pool = getDbPool();
  try {
    await pool.query(
      'UPDATE submissions SET state = $1, updated_at = NOW() WHERE id = $2',
      [state, submissionId]
    );
    console.log(`[activities] Updated submission ${submissionId} state to ${state}`);
  } catch (error) {
    console.error(`[activities] Failed to update submission state:`, error);
    // Don't throw - state update failure shouldn't fail the workflow
  }
}

export async function preCheckSubmission(args: { submissionId: string }): Promise<{ passed: boolean; agentId: string; agentRevisionId: string; warnings: string[] }> {
  console.log(`[activities] preCheckSubmission ${args.submissionId}`);
  return {
    passed: true,
    agentId: `agent-${args.submissionId}`,
    agentRevisionId: `${args.submissionId}-rev1`,
    warnings: []
  };
}

export async function runSecurityGate(args: { submissionId: string; agentId: string; agentRevisionId: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string } }): Promise<{ passed: boolean; artifactsPath: string; summaryPath: string; reportPath: string; promptsPath: string; metadataPath: string; summary?: Record<string, unknown>; wandb?: WandbRunInfo; failReasons?: string[]; ledgerEntryPath?: string; ledgerDigest?: string; ledgerSourceFile?: string; ledgerHttpPosted?: boolean; ledgerHttpAttempts?: number; ledgerHttpError?: string }> {
  console.log(`[activities] runSecurityGate submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  const cliArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--template', 'google-adk',
    '--output-dir', artifactsPath,
    '--skip-functional',
    '--schema-dir', '/app/sandbox-runner/schemas',
    '--prompt-manifest', '/app/prompts/aisi/manifest.sample.json'
  ];
  appendWandbCliArgs(cliArgs, args.wandbRun);
  if (args.agentCardPath) {
    cliArgs.push('--agent-card', args.agentCardPath);
  }
  if (args.relay?.endpoint) {
    cliArgs.push('--relay-endpoint', args.relay.endpoint, '--security-endpoint', args.relay.endpoint);
  }
  if (args.relay?.token) {
    cliArgs.push('--relay-token', args.relay.token, '--security-endpoint-token', args.relay.token);
  }
  await runSandboxCli(cliArgs);
  const summaryPath = path.join(artifactsPath, 'security', 'security_summary.json');
  const summary = await readJsonFile<Record<string, unknown>>(summaryPath) ?? {};
  const promptsPath = typeof (summary as any).promptsArtifact === 'string'
    ? (summary as any).promptsArtifact as string
    : path.join(artifactsPath, 'security', 'security_prompts.jsonl');
  const reportPath = path.join(artifactsPath, 'security', 'security_report.jsonl');
  const metadataPath = path.join(artifactsPath, 'metadata.json');
  const metadata = await readJsonFile(metadataPath);
  const wandb = extractWandbFromMetadata(metadata) ?? args.wandbRun;
  const needsReview = (summary as any).needsReview ?? (summary as any).needs_review;
  const passed = typeof needsReview === 'number' ? needsReview === 0 : !(summary as any).error;
  const ledgerInfo = await recordSecurityLedger({
    workflowId: args.workflowId,
    workflowRunId: args.workflowRunId,
    submissionId: args.submissionId,
    agentId: args.agentId,
    agentRevisionId: args.agentRevisionId,
    summaryPath,
    reportPath,
    promptsPath,
    summary
  });
  await upsertStageMetadata(args.agentRevisionId, 'security', {
    summary,
    ledger: ledgerInfo.entryPath
      ? {
          entryPath: ledgerInfo.entryPath,
          digest: ledgerInfo.digest,
          sourceFile: ledgerInfo.sourceFile,
          httpPosted: ledgerInfo.httpPosted,
          httpAttempts: ledgerInfo.httpAttempts,
          httpError: ledgerInfo.httpError
        }
      : undefined
  });
  return {
    passed,
    artifactsPath,
    summaryPath,
    reportPath,
    promptsPath,
    metadataPath,
    summary,
    wandb,
    ledgerEntryPath: ledgerInfo.entryPath,
    ledgerDigest: ledgerInfo.digest,
    ledgerSourceFile: ledgerInfo.sourceFile,
    ledgerHttpPosted: ledgerInfo.httpPosted,
    ledgerHttpAttempts: ledgerInfo.httpAttempts,
    ledgerHttpError: ledgerInfo.httpError,
    failReasons: (summary as any).error
      ? [(summary as any).error]
      : needsReview && needsReview > 0
        ? ['security_gate_flagged']
        : undefined
  };
}

export async function runFunctionalAccuracy(args: { submissionId: string; agentId: string; agentRevisionId: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string } }): Promise<{ passed: boolean; metrics: { averageDistance?: number; embeddingAverageDistance?: number; embeddingMaxDistance?: number }; artifactsPath: string; summaryPath: string; reportPath: string; promptsPath: string; metadataPath: string; summary?: Record<string, unknown>; wandb?: WandbRunInfo; failReasons?: string[]; ledgerEntryPath?: string; ledgerDigest?: string; ledgerSourceFile?: string; ledgerHttpPosted?: boolean; ledgerHttpAttempts?: number; ledgerHttpError?: string }> {
  console.log(`[activities] runFunctionalAccuracy submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  const cliArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--template', 'google-adk',
    '--output-dir', artifactsPath,
    '--skip-security-gate',
    '--schema-dir', '/app/sandbox-runner/schemas',
    '--prompt-manifest', '/app/prompts/aisi/manifest.sample.json'
  ];
  appendWandbCliArgs(cliArgs, args.wandbRun);
  if (args.agentCardPath) {
    cliArgs.push('--agent-card', args.agentCardPath);
  }
  if (args.relay?.endpoint) {
    cliArgs.push('--relay-endpoint', args.relay.endpoint, '--functional-endpoint', args.relay.endpoint);
  }
  if (args.relay?.token) {
    cliArgs.push('--relay-token', args.relay.token);
    cliArgs.push('--functional-endpoint-token', args.relay.token);
  }
  await runSandboxCli(cliArgs);
  const summaryPath = path.join(artifactsPath, 'functional', 'functional_summary.json');
  const summary = await readJsonFile<Record<string, unknown>>(summaryPath) ?? {};
  const reportPath = path.join(artifactsPath, 'functional', 'functional_report.jsonl');
  const promptsPath = typeof (summary as any).promptsArtifact === 'string'
    ? (summary as any).promptsArtifact as string
    : path.join(artifactsPath, 'functional', 'functional_scenarios.jsonl');
  const metadataPath = path.join(artifactsPath, 'metadata.json');
  const metadata = await readJsonFile(metadataPath);
  const wandb = extractWandbFromMetadata(metadata) ?? args.wandbRun;
  const passed = (summary as any).needsReview ? (summary as any).needsReview === 0 : !(summary as any).error;
  const ledgerInfo = await recordFunctionalLedger({
    workflowId: args.workflowId,
    workflowRunId: args.workflowRunId,
    submissionId: args.submissionId,
    agentId: args.agentId,
    agentRevisionId: args.agentRevisionId,
    summaryPath,
    reportPath,
    promptsPath,
    summary
  });
  await upsertStageMetadata(args.agentRevisionId, 'functional', {
    summary,
    metrics: {
      averageDistance: (summary as any).averageDistance,
      embeddingAverageDistance: (summary as any).embeddingAverageDistance,
      embeddingMaxDistance: (summary as any).embeddingMaxDistance
    },
    ledger: ledgerInfo.entryPath
      ? {
          entryPath: ledgerInfo.entryPath,
          digest: ledgerInfo.digest,
          sourceFile: ledgerInfo.sourceFile,
          httpPosted: ledgerInfo.httpPosted,
          httpAttempts: ledgerInfo.httpAttempts,
          httpError: ledgerInfo.httpError
        }
      : undefined
  });
  return {
    passed,
    metrics: {
      averageDistance: (summary as any).averageDistance,
      embeddingAverageDistance: (summary as any).embeddingAverageDistance,
      embeddingMaxDistance: (summary as any).embeddingMaxDistance
    },
    artifactsPath,
    summaryPath,
    reportPath,
    promptsPath,
    metadataPath,
    summary,
    wandb,
    failReasons: (summary as any).error ? [(summary as any).error] : undefined,
    ledgerEntryPath: ledgerInfo.entryPath,
    ledgerDigest: ledgerInfo.digest,
    ledgerSourceFile: ledgerInfo.sourceFile,
    ledgerHttpPosted: ledgerInfo.httpPosted,
    ledgerHttpAttempts: ledgerInfo.httpAttempts,
    ledgerHttpError: ledgerInfo.httpError
  };
}

export async function runJudgePanel(args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string }; llmJudge?: LlmJudgeConfig }): Promise<{ verdict: 'approve' | 'reject' | 'manual'; score: number; explanation?: string; artifactsPath: string; reportPath: string; summaryPath: string; relayLogPath: string; summary?: Record<string, unknown>; ledgerEntryPath?: string; ledgerDigest?: string; ledgerSourceFile?: string; ledgerHttpPosted?: boolean; ledgerHttpAttempts?: number; ledgerHttpError?: string }> {
  console.log(`[activities] runJudgePanel submission=${args.submissionId} prompt=${args.promptVersion}`);
  const outDir = path.join(INSPECT_OUT_DIR, args.agentId, args.agentRevisionId);
  await fs.mkdir(outDir, { recursive: true });
  const inspectArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--artifacts', path.join(SANDBOX_ARTIFACTS_DIR, args.agentRevisionId),
    '--manifest', path.join(PROJECT_ROOT, 'prompts', 'aisi', 'manifest.tier3.json'),
    '--enable-judge-panel',
    '--agent-card', args.agentCardPath ?? path.join(SANDBOX_ARTIFACTS_DIR, args.agentRevisionId, 'agent_card.json'),
    '--submission-id', args.submissionId
  ];
  appendWandbCliArgs(inspectArgs, args.wandbRun);
  if (args.relay?.endpoint) {
    inspectArgs.push('--relay-endpoint', args.relay.endpoint);
  } else {
    inspectArgs.push('--judge-dry-run');
  }
  if (args.relay?.token) {
    inspectArgs.push('--relay-token', args.relay.token);
  }
  inspectArgs.push(...buildJudgeLlmArgs(args.llmJudge));
  await runInspectCli(inspectArgs);
  const judgeDir = path.join(outDir, 'judge');
  const summaryPath = path.join(judgeDir, 'judge_summary.json');
  const summary = await readJsonFile<Record<string, unknown>>(summaryPath) ?? {};
  const relayLogPath = path.join(judgeDir, 'relay_logs.jsonl');
  const reportPath = path.join(judgeDir, 'judge_report.jsonl');
  const rejected = (summary as any).rejected ?? 0;
  const manual = (summary as any).manual ?? 0;
  const flagged = (summary as any).flagged ?? 0;
  const total = (summary as any).questions ?? 0;
  const approved = (summary as any).approved ?? 0;
  const score = total > 0 ? approved / total : 0;
  let verdict: 'approve' | 'reject' | 'manual' = 'approve';
  if (rejected > 0) {
    verdict = 'reject';
  } else if (manual > 0 || flagged > 0) {
    verdict = 'manual';
  }
  const explanation = (summary as any).notes ?? `approved=${approved}, manual=${manual}, rejected=${rejected}`;
  const ledgerInfo = await recordJudgeLedger({
    workflowId: args.workflowId,
    workflowRunId: args.workflowRunId,
    submissionId: args.submissionId,
    agentId: args.agentId,
    agentRevisionId: args.agentRevisionId,
    summaryPath,
    reportPath,
    relayLogPath,
    summary
  });

  const llmSummary = (summary as any)?.llmJudge ?? args.llmJudge;
  await upsertStageMetadata(args.agentRevisionId, 'judge', {
    summary,
    llmJudge: llmSummary,
    ledger: ledgerInfo.entryPath
      ? {
          entryPath: ledgerInfo.entryPath,
          digest: ledgerInfo.digest,
          sourceFile: ledgerInfo.sourceFile,
          httpPosted: ledgerInfo.httpPosted,
          httpAttempts: ledgerInfo.httpAttempts,
          httpError: ledgerInfo.httpError
        }
      : undefined
  });

  return {
    verdict,
    score,
    explanation,
    artifactsPath: outDir,
    reportPath,
    summaryPath,
    relayLogPath,
    summary,
    ledgerEntryPath: ledgerInfo.entryPath,
    ledgerDigest: ledgerInfo.digest,
    ledgerSourceFile: ledgerInfo.sourceFile,
    ledgerHttpPosted: ledgerInfo.httpPosted,
    ledgerHttpAttempts: ledgerInfo.httpAttempts,
    ledgerHttpError: ledgerInfo.httpError
  };
}

export async function notifyHumanReview(args: { submissionId: string; agentId: string; agentRevisionId: string; reason: string; attachments?: string[] }): Promise<'approved' | 'rejected'> {
  console.log(`[activities] notifyHumanReview submission=${args.submissionId} reason=${args.reason}`);
  return 'approved';
}

export async function publishAgent(args: { submissionId: string; agentId: string; agentRevisionId: string }): Promise<void> {
  console.log(`[activities] publishAgent submission=${args.submissionId} agent=${args.agentId}`);
}

const PYTHON_BIN = process.env.SANDBOX_PYTHON ?? 'python3.13';

function runSandboxCli(cliArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ['-m', 'sandbox_runner.cli', ...cliArgs], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sandbox_runner.cli exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

function runInspectCli(cliArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(INSPECT_PYTHON, [INSPECT_SCRIPT, ...cliArgs], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`inspect-worker run_eval exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

export function buildJudgeLlmArgs(llm?: LlmJudgeConfig): string[] {
  if (!llm) {
    return [];
  }
  const args: string[] = [];
  if (llm.enabled) {
    args.push('--judge-llm-enabled');
    if (llm.provider) {
      args.push('--judge-llm-provider', llm.provider);
    }
    if (llm.model) {
      args.push('--judge-llm-model', llm.model);
    }
    if (typeof llm.temperature === 'number') {
      args.push('--judge-llm-temperature', llm.temperature.toString());
    }
    if (typeof llm.maxOutputTokens === 'number') {
      args.push('--judge-llm-max-output', llm.maxOutputTokens.toString());
    }
    if (llm.baseUrl) {
      args.push('--judge-llm-base-url', llm.baseUrl);
    }
  }
  if (llm.dryRun) {
    args.push('--judge-llm-dry-run');
  }
  return args;
}

export async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function tryHashFile(filePath?: string): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  try {
    return await hashFile(filePath);
  } catch (err) {
    console.warn(`[activities] failed to hash file ${filePath}`, err);
    return undefined;
  }
}

type LedgerRecordResult = {
  entryPath?: string;
  digest?: string;
  sourceFile?: string;
  httpPosted?: boolean;
  httpAttempts?: number;
  httpError?: string;
};

export async function recordSecurityLedger(args: {
  workflowId: string;
  workflowRunId: string;
  submissionId: string;
  agentId: string;
  agentRevisionId: string;
  summaryPath: string;
  reportPath: string;
  promptsPath: string;
  summary: Record<string, unknown>;
}): Promise<LedgerRecordResult> {
  try {
    const summaryDigest = await hashFile(args.summaryPath);
    const payload = {
      stage: 'security',
      submissionId: args.submissionId,
      agentId: args.agentId,
      agentRevisionId: args.agentRevisionId,
      summaryPath: args.summaryPath,
      summaryDigest,
      reportPath: args.reportPath,
      promptsPath: args.promptsPath,
      categories: args.summary.categories,
      generatedAt: args.summary.generatedAt ?? Date.now()
    };
    const payloadPath = path.join(path.dirname(args.summaryPath), 'security_ledger_entry.json');
    await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const ledgerDigest = await hashFile(payloadPath);
    const auditEntry: AuditLedgerEntry = {
      workflowId: args.workflowId,
      runId: args.workflowRunId ?? null,
      namespace: NAMESPACE,
      historyDigestSha256: ledgerDigest,
      exportedAt: new Date().toISOString(),
      sourceFile: payloadPath
    };
    const publishResult = await publishToLedger(auditEntry, {
      outputDir: process.env.SECURITY_LEDGER_DIR,
      httpEndpoint: process.env.SECURITY_LEDGER_ENDPOINT,
      httpToken: process.env.SECURITY_LEDGER_TOKEN
    });
    return {
      entryPath: publishResult.entryPath,
      digest: ledgerDigest,
      sourceFile: payloadPath,
      httpPosted: publishResult.httpPosted,
      httpAttempts: publishResult.httpAttempts,
      httpError: publishResult.httpError
    };
  } catch (err) {
    console.warn('[activities] failed to record security ledger entry', err);
    return {};
  }
}

export async function recordFunctionalLedger(args: {
  workflowId: string;
  workflowRunId: string;
  submissionId: string;
  agentId: string;
  agentRevisionId: string;
  summaryPath: string;
  reportPath: string;
  promptsPath: string;
  summary: Record<string, unknown>;
}): Promise<LedgerRecordResult> {
  try {
    const summaryDigest = await hashFile(args.summaryPath);
    const reportDigest = await tryHashFile(args.reportPath);
    const promptsDigest = await tryHashFile(args.promptsPath);
    const payload = {
      stage: 'functional',
      submissionId: args.submissionId,
      agentId: args.agentId,
      agentRevisionId: args.agentRevisionId,
      summaryPath: args.summaryPath,
      summaryDigest,
      reportPath: args.reportPath,
      reportDigest,
      promptsPath: args.promptsPath,
      promptsDigest,
      metrics: {
        averageDistance: (args.summary as any)?.averageDistance,
        embeddingAverageDistance: (args.summary as any)?.embeddingAverageDistance,
        embeddingMaxDistance: (args.summary as any)?.embeddingMaxDistance,
        successRate: (args.summary as any)?.successRate
      },
      needsReview: (args.summary as any)?.needsReview,
      ragtruth: (args.summary as any)?.ragTruthArtifact ?? (args.summary as any)?.ragtruthArtifact,
      generatedAt: (args.summary as any)?.generatedAt ?? Date.now()
    };
    const payloadPath = path.join(path.dirname(args.summaryPath), 'functional_ledger_entry.json');
    await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const ledgerDigest = await hashFile(payloadPath);
    const auditEntry: AuditLedgerEntry = {
      workflowId: args.workflowId,
      runId: args.workflowRunId ?? null,
      namespace: NAMESPACE,
      historyDigestSha256: ledgerDigest,
      exportedAt: new Date().toISOString(),
      sourceFile: payloadPath
    };
    const publishResult = await publishToLedger(auditEntry, {
      outputDir: process.env.FUNCTIONAL_LEDGER_DIR ?? process.env.SECURITY_LEDGER_DIR,
      httpEndpoint: process.env.FUNCTIONAL_LEDGER_ENDPOINT ?? process.env.SECURITY_LEDGER_ENDPOINT,
      httpToken: process.env.FUNCTIONAL_LEDGER_TOKEN ?? process.env.SECURITY_LEDGER_TOKEN
    });
    return {
      entryPath: publishResult.entryPath,
      digest: ledgerDigest,
      sourceFile: payloadPath,
      httpPosted: publishResult.httpPosted,
      httpAttempts: publishResult.httpAttempts,
      httpError: publishResult.httpError
    };
  } catch (err) {
    console.warn('[activities] failed to record functional ledger entry', err);
    return {};
  }
}

export async function recordJudgeLedger(args: {
  workflowId: string;
  workflowRunId: string;
  submissionId: string;
  agentId: string;
  agentRevisionId: string;
  summaryPath: string;
  reportPath: string;
  relayLogPath: string;
  summary: Record<string, unknown>;
}): Promise<LedgerRecordResult> {
  try {
    const summaryDigest = await hashFile(args.summaryPath);
    const reportDigest = await hashFile(args.reportPath);
    const relayDigest = await hashFile(args.relayLogPath);
    const payload = {
      stage: 'judge',
      submissionId: args.submissionId,
      agentId: args.agentId,
      agentRevisionId: args.agentRevisionId,
      summaryPath: args.summaryPath,
      summaryDigest,
      reportPath: args.reportPath,
      reportDigest,
      relayLogPath: args.relayLogPath,
      relayLogDigest: relayDigest,
      verdictCounts: {
        approved: (args.summary as any)?.approved ?? 0,
        manual: (args.summary as any)?.manual ?? 0,
        rejected: (args.summary as any)?.rejected ?? 0
      },
      llmJudge: (args.summary as any)?.llmJudge,
      relayErrors: (args.summary as any)?.relayErrors,
      generatedAt: (args.summary as any)?.generatedAt ?? Date.now()
    };
    const payloadPath = path.join(path.dirname(args.summaryPath), 'judge_ledger_entry.json');
    await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const ledgerDigest = await hashFile(payloadPath);
    const auditEntry: AuditLedgerEntry = {
      workflowId: args.workflowId,
      runId: args.workflowRunId ?? null,
      namespace: NAMESPACE,
      historyDigestSha256: ledgerDigest,
      exportedAt: new Date().toISOString(),
      sourceFile: payloadPath
    };
    const publishResult = await publishToLedger(auditEntry, {
      outputDir: process.env.JUDGE_LEDGER_DIR ?? process.env.SECURITY_LEDGER_DIR,
      httpEndpoint: process.env.JUDGE_LEDGER_ENDPOINT ?? process.env.SECURITY_LEDGER_ENDPOINT,
      httpToken: process.env.JUDGE_LEDGER_TOKEN ?? process.env.SECURITY_LEDGER_TOKEN
    });
    return {
      entryPath: publishResult.entryPath,
      digest: ledgerDigest,
      sourceFile: payloadPath,
      httpPosted: publishResult.httpPosted,
      httpAttempts: publishResult.httpAttempts,
      httpError: publishResult.httpError
    };
  } catch (err) {
    console.warn('[activities] failed to record judge ledger entry', err);
    return {};
  }
}

export async function recordStageEvent(args: { agentRevisionId: string; stage: StageName; event: string; data?: Record<string, unknown>; timestamp?: string; severity?: 'info' | 'warn' | 'error'; links?: Record<string, string> }): Promise<void> {
  const occurredAt = args.timestamp ?? new Date().toISOString();
  const eventData = args.data && Object.keys(args.data).length > 0 ? args.data : undefined;
  const payload: Record<string, unknown> = {
    stage: args.stage,
    event: args.event,
    type: args.event,
    timestamp: occurredAt,
    severity: args.severity ?? 'info'
  };
  if (eventData) {
    payload.data = eventData;
  }
  if (args.links) {
    payload.links = args.links;
  }
  await upsertStageMetadata(args.agentRevisionId, args.stage, {
    lastEvent: {
      event: args.event,
      timestamp: occurredAt,
      ...(eventData ? { data: eventData } : {}),
      ...(args.links ? { links: args.links } : {})
    }
  });
  await appendWandbEvent(args.agentRevisionId, payload);
  await logWandbStageEvent(args.agentRevisionId, args.stage, args.event, eventData, occurredAt, args.severity ?? 'info', args.links);
}

export async function recordHumanDecisionMetadata(args: { agentRevisionId: string; decision: 'approved' | 'rejected'; notes?: string; decidedAt?: string }): Promise<void> {
  const decidedAt = args.decidedAt ?? new Date().toISOString();
  await upsertStageMetadata(args.agentRevisionId, 'human', {
    decision: args.decision,
    notes: args.notes,
    decidedAt
  });
  await recordStageEvent({
    agentRevisionId: args.agentRevisionId,
    stage: 'human',
    event: 'human_decision',
    data: { decision: args.decision, notes: args.notes },
    timestamp: decidedAt
  });
  await logWandbHumanDecision(args.agentRevisionId, args.decision, args.notes);
}

async function upsertStageMetadata(agentRevisionId: string, stage: string, update: Record<string, unknown>): Promise<void> {
  const metadataPath = path.join(SANDBOX_ARTIFACTS_DIR, agentRevisionId, 'metadata.json');
  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(raw);
    const sanitized = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
    if (Object.keys(sanitized).length === 0) {
      return;
    }
    metadata.stageDetails = metadata.stageDetails ?? {};
    metadata.stageDetails[stage] = { ...(metadata.stageDetails[stage] ?? {}), ...sanitized };
    const wandbMcp = metadata.wandbMcp ?? {};
    const stages = wandbMcp.stages ?? {};
    stages[stage] = { ...(stages[stage] ?? {}), ...sanitized };
    metadata.wandbMcp = { ...wandbMcp, stages };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[activities] failed to upsert stage metadata', err);
    }
  }
}

async function appendWandbEvent(agentRevisionId: string, event: Record<string, unknown>): Promise<void> {
  const metadataPath = path.join(SANDBOX_ARTIFACTS_DIR, agentRevisionId, 'metadata.json');
  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(raw);
    metadata.wandbMcp = metadata.wandbMcp ?? {};
    metadata.wandbMcp.events = Array.isArray(metadata.wandbMcp.events) ? metadata.wandbMcp.events : [];
    metadata.wandbMcp.events.push({
      ...event,
      id: event.id ?? `event-${Date.now()}`
    });
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[activities] failed to append wandb event', err);
    }
  }
}

async function logWandbStageEvent(agentRevisionId: string, stage: StageName, event: string, data: Record<string, unknown> | undefined, timestamp: string, severity: 'info' | 'warn' | 'error', links?: Record<string, string>): Promise<void> {
  try {
    const wandb = await resolveWandbInfo(agentRevisionId);
    if (!wandb?.runId || !wandb?.project || !wandb?.entity) {
      return;
    }
    const payload: Record<string, unknown> = {
      'event/stage': stage,
      'event/name': event,
      'event/timestamp': timestamp,
      [`events/${stage}/${event}`]: 1,
      'event/severity': severity
    };
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        const metricKey = `event/${stage}/${event}/${key}`;
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
          payload[metricKey] = value;
        } else {
          payload[metricKey] = JSON.stringify(value);
        }
      }
    }
    if (links) {
      for (const [key, value] of Object.entries(links)) {
        payload[`event/${stage}/${event}/link/${key}`] = value;
      }
    }
    await logWandbEvent(wandb, payload);
  } catch (err) {
    console.warn('[activities] failed to log stage event to W&B', err);
  }
}

async function logWandbHumanDecision(agentRevisionId: string, decision: 'approved' | 'rejected', notes?: string): Promise<void> {
  try {
    const wandb = await resolveWandbInfo(agentRevisionId);
    if (!wandb?.runId || !wandb?.project || !wandb?.entity) {
      return;
    }
    const payload: Record<string, unknown> = {
      'human/decision': decision === 'approved' ? 1 : 0,
      'human/decision_state': decision
    };
    if (notes) {
      payload['human/decision_notes'] = notes;
    }
    await logWandbEvent(wandb, payload);
  } catch (err) {
    console.warn('[activities] failed to log human decision to W&B', err);
  }
}

function logWandbEvent(wandb: WandbRunInfo, event: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!wandb.runId || !wandb.project || !wandb.entity) {
      return resolve();
    }
    const env = {
      ...process.env,
      ...(wandb.baseUrl ? { WANDB_BASE_URL: wandb.baseUrl } : {})
    };
    const args = [
      '-m',
      'sandbox_runner.log_wandb_event',
      '--run-id', wandb.runId,
      '--project', wandb.project,
      '--entity', wandb.entity,
      '--event', JSON.stringify(event)
    ];
    if (wandb.baseUrl) {
      args.push('--base-url', wandb.baseUrl);
    }
    const child = spawn(PYTHON_BIN, args, {
      cwd: PROJECT_ROOT,
      env
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

export async function updateSubmissionTrustScore(args: {
  submissionId: string;
  agentId: string;
  trustScore: TrustScoreBreakdown;
  autoDecision: 'auto_approved' | 'auto_rejected' | 'requires_human_review';
  stage: string;
}): Promise<void> {
  const { submissionId, agentId, trustScore, autoDecision, stage } = args;

  console.log(`[activities] Updating trust score for submission ${submissionId}: ${trustScore.total}/100 => ${autoDecision}`);

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update submissions table with trust scores
    await client.query(
      `UPDATE submissions
       SET
         trust_score = $1,
         security_score = $2,
         functional_score = $3,
         judge_score = $4,
         implementation_score = $5,
         score_breakdown = $6,
         auto_decision = $7,
         updated_at = now()
       WHERE id = $8`,
      [
        trustScore.total,
        trustScore.security,
        trustScore.functional,
        trustScore.judge,
        trustScore.implementation,
        JSON.stringify(trustScore),
        autoDecision,
        submissionId
      ]
    );

    // Insert into trust_score_history for audit trail
    await client.query(
      `INSERT INTO trust_score_history
       (submission_id, agent_id, previous_score, new_score, score_change, change_reason, stage, triggered_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        submissionId,
        agentId,
        0, // previous_score (TODO: fetch from DB if updating)
        trustScore.total,
        trustScore.total, // score_change
        `Trust score calculated: ${autoDecision}`,
        stage,
        'system',
        JSON.stringify({
          breakdown: {
            security: trustScore.security,
            functional: trustScore.functional,
            judge: trustScore.judge,
            implementation: trustScore.implementation
          },
          reasoning: trustScore.reasoning,
          autoDecision
        })
      ]
    );

    await client.query('COMMIT');
    console.log(`[activities] Trust score persisted to database for submission ${submissionId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[activities] Failed to update trust score for submission ${submissionId}:`, err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update submission state in database
 */
export async function updateSubmissionState(args: {
  submissionId: string;
  state: string;
}): Promise<void> {
  const { submissionId, state } = args;

  console.log(`[activities] Updating submission state for ${submissionId}: ${state}`);

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE submissions
       SET state = $1, updated_at = now()
       WHERE id = $2`,
      [state, submissionId]
    );

    console.log(`[activities] Submission state updated to ${state} for ${submissionId}`);
  } catch (err) {
    console.error(`[activities] Failed to update submission state for ${submissionId}:`, err);
    throw err;
  } finally {
    client.release();
  }
}
