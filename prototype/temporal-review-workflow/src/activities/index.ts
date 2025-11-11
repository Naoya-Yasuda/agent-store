import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { WandbRunInfo, LlmJudgeConfig } from '../workflows/reviewPipeline.workflow';
import { publishToLedger, AuditLedgerEntry } from '../lib/auditLedger';
import { NAMESPACE } from '../../temporal.config';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const SANDBOX_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'sandbox-runner', 'artifacts');
const INSPECT_OUT_DIR = path.join(PROJECT_ROOT, 'prototype', 'inspect-worker', 'out');
const INSPECT_SCRIPT = path.join(PROJECT_ROOT, 'prototype', 'inspect-worker', 'scripts', 'run_eval.py');
const SANDBOX_PYTHON = process.env.SANDBOX_PYTHON ?? 'python3.13';
const INSPECT_PYTHON = process.env.INSPECT_PYTHON ?? 'python3.13';

async function ensureSandboxArtifacts(agentRevisionId: string): Promise<string> {
  await fs.mkdir(SANDBOX_ARTIFACTS_DIR, { recursive: true });
  const stageDir = path.join(SANDBOX_ARTIFACTS_DIR, agentRevisionId);
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

export async function preCheckSubmission(args: { submissionId: string }): Promise<{ passed: boolean; agentId: string; agentRevisionId: string; warnings: string[] }> {
  console.log(`[activities] preCheckSubmission ${args.submissionId}`);
  return {
    passed: true,
    agentId: `agent-${args.submissionId}`,
    agentRevisionId: `${args.submissionId}-rev1`,
    warnings: []
  };
}

export async function runSecurityGate(args: { submissionId: string; agentId: string; agentRevisionId: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string } }): Promise<{ passed: boolean; artifactsPath: string; summaryPath: string; reportPath: string; promptsPath: string; metadataPath: string; summary?: Record<string, unknown>; wandb?: WandbRunInfo; failReasons?: string[]; ledgerEntryPath?: string; ledgerDigest?: string }> {
  console.log(`[activities] runSecurityGate submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  const cliArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--template', 'google-adk',
    '--output-dir', artifactsPath,
    '--skip-functional'
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
    failReasons: (summary as any).error
      ? [(summary as any).error]
      : needsReview && needsReview > 0
        ? ['security_gate_flagged']
        : undefined
  };
}

export async function runFunctionalAccuracy(args: { submissionId: string; agentId: string; agentRevisionId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string } }): Promise<{ passed: boolean; metrics: { averageDistance?: number; embeddingAverageDistance?: number; embeddingMaxDistance?: number }; artifactsPath: string; summaryPath: string; reportPath: string; promptsPath: string; metadataPath: string; summary?: Record<string, unknown>; wandb?: WandbRunInfo; failReasons?: string[] }> {
  console.log(`[activities] runFunctionalAccuracy submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  const cliArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--template', 'google-adk',
    '--output-dir', artifactsPath,
    '--skip-security-gate'
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
    failReasons: (summary as any).error ? [(summary as any).error] : undefined
  };
}

export async function runJudgePanel(args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string }; llmJudge?: LlmJudgeConfig }): Promise<{ verdict: 'approve' | 'reject' | 'manual'; score: number; explanation?: string; artifactsPath: string; reportPath: string; summaryPath: string; relayLogPath: string; summary?: Record<string, unknown>; ledgerEntryPath?: string; ledgerDigest?: string }> {
  console.log(`[activities] runJudgePanel submission=${args.submissionId} prompt=${args.promptVersion}`);
  const outDir = path.join(INSPECT_OUT_DIR, args.agentId, args.agentRevisionId);
  await fs.mkdir(outDir, { recursive: true });
  const inspectArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--artifacts', path.join(SANDBOX_ARTIFACTS_DIR, args.agentRevisionId),
    '--manifest', path.join(PROJECT_ROOT, 'prompts', 'aisi', 'manifest.tier3.json'),
    '--enable-judge-panel',
    '--agent-card', args.agentCardPath ?? path.join(SANDBOX_ARTIFACTS_DIR, args.agentRevisionId, 'agent_card.json')
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
  appendJudgeLlmArgs(inspectArgs, args.llmJudge);
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
    ledgerDigest: ledgerInfo.digest
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

function appendJudgeLlmArgs(cliArgs: string[], llm?: LlmJudgeConfig): void {
  if (!llm) {
    return;
  }
  if (llm.enabled) {
    cliArgs.push('--judge-llm-enabled');
    if (llm.provider) {
      cliArgs.push('--judge-llm-provider', llm.provider);
    }
    if (llm.model) {
      cliArgs.push('--judge-llm-model', llm.model);
    }
    if (typeof llm.temperature === 'number') {
      cliArgs.push('--judge-llm-temperature', llm.temperature.toString());
    }
    if (typeof llm.maxOutputTokens === 'number') {
      cliArgs.push('--judge-llm-max-output', llm.maxOutputTokens.toString());
    }
    if (llm.baseUrl) {
      cliArgs.push('--judge-llm-base-url', llm.baseUrl);
    }
  }
  if (llm.dryRun) {
    cliArgs.push('--judge-llm-dry-run');
  }
}

export async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

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
}): Promise<{ entryPath?: string; digest?: string }> {
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
    const entryPath = await publishToLedger(auditEntry, {
      outputDir: process.env.SECURITY_LEDGER_DIR,
      httpEndpoint: process.env.SECURITY_LEDGER_ENDPOINT,
      httpToken: process.env.SECURITY_LEDGER_TOKEN
    });
    return { entryPath, digest: ledgerDigest };
  } catch (err) {
    console.warn('[activities] failed to record security ledger entry', err);
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
}): Promise<{ entryPath?: string; digest?: string }> {
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
    const entryPath = await publishToLedger(auditEntry, {
      outputDir: process.env.JUDGE_LEDGER_DIR ?? process.env.SECURITY_LEDGER_DIR,
      httpEndpoint: process.env.JUDGE_LEDGER_ENDPOINT ?? process.env.SECURITY_LEDGER_ENDPOINT,
      httpToken: process.env.JUDGE_LEDGER_TOKEN ?? process.env.SECURITY_LEDGER_TOKEN
    });
    return { entryPath, digest: ledgerDigest };
  } catch (err) {
    console.warn('[activities] failed to record judge ledger entry', err);
    return {};
  }
}
