import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { WandbRunInfo } from '../workflows/reviewPipeline.workflow';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const SANDBOX_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'sandbox-runner', 'artifacts');
const INSPECT_OUT_DIR = path.join(PROJECT_ROOT, 'prototype', 'inspect-worker', 'out');
const SANDBOX_PYTHON = process.env.SANDBOX_PYTHON ?? 'python3.13';
const INSPECT_PYTHON = process.env.INSPECT_PYTHON ?? 'python3.13';

async function ensureSandboxArtifacts(agentRevisionId: string): Promise<string> {
  await fs.mkdir(SANDBOX_ARTIFACTS_DIR, { recursive: true });
  const stageDir = path.join(SANDBOX_ARTIFACTS_DIR, agentRevisionId);
  await fs.mkdir(stageDir, { recursive: true });
  return stageDir;
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

export async function runSecurityGate(args: { submissionId: string; agentId: string; agentRevisionId: string; wandbRun?: WandbRunInfo }): Promise<{ passed: boolean; artifactsPath: string; failReasons?: string[] }> {
  console.log(`[activities] runSecurityGate submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  const cliArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--template', 'google-adk',
    '--output-dir', artifactsPath,
    '--skip-functional'
  ];
  if (args.wandbRun?.runId) {
    cliArgs.push('--wandb-run-id', args.wandbRun.runId);
  }
  if (args.wandbRun?.project) {
    cliArgs.push('--wandb-project', args.wandbRun.project);
  }
  if (args.wandbRun?.entity) {
    cliArgs.push('--wandb-entity', args.wandbRun.entity);
  }
  if (args.wandbRun?.baseUrl) {
    cliArgs.push('--wandb-base-url', args.wandbRun.baseUrl);
  }
  await runSandboxCli(cliArgs);
  const summaryPath = path.join(artifactsPath, 'security', 'security_summary.json');
  let summary: any = {};
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  } catch (err) {
    console.warn('[activities] security summary not found', err);
  }
  const needsReview = summary.needsReview ?? summary.needs_review;
  const passed = typeof needsReview === 'number' ? needsReview === 0 : !summary.error;
  return {
    passed,
    artifactsPath,
    failReasons: summary.error
      ? [summary.error]
      : needsReview && needsReview > 0
        ? ['security_gate_flagged']
        : undefined
  };
}

export async function runFunctionalAccuracy(args: { submissionId: string; agentId: string; agentRevisionId: string; wandbRun?: WandbRunInfo }): Promise<{ passed: boolean; metrics: { embeddingVariance: number }; failReasons?: string[] }> {
  console.log(`[activities] runFunctionalAccuracy submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  const cliArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--template', 'google-adk',
    '--output-dir', artifactsPath,
    '--skip-security-gate'
  ];
  if (args.wandbRun?.runId) {
    cliArgs.push('--wandb-run-id', args.wandbRun.runId);
  }
  if (args.wandbRun?.project) {
    cliArgs.push('--wandb-project', args.wandbRun.project);
  }
  if (args.wandbRun?.entity) {
    cliArgs.push('--wandb-entity', args.wandbRun.entity);
  }
  if (args.wandbRun?.baseUrl) {
    cliArgs.push('--wandb-base-url', args.wandbRun.baseUrl);
  }
  await runSandboxCli(cliArgs);
  const summaryPath = path.join(artifactsPath, 'functional', 'functional_summary.json');
  let summary: any = {};
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  } catch (err) {
    console.warn('[activities] functional summary not found', err);
  }
  return {
    passed: summary.needsReview ? summary.needsReview === 0 : !summary.error,
    metrics: { embeddingVariance: summary.averageDistance ?? 0.0 },
    failReasons: summary.error ? [summary.error] : undefined
  };
}

export async function runJudgePanel(args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string; wandbRun?: WandbRunInfo }): Promise<{ verdict: 'approve' | 'reject' | 'manual'; score: number; explanation?: string }> {
  console.log(`[activities] runJudgePanel submission=${args.submissionId} prompt=${args.promptVersion}`);
  const outDir = path.join(INSPECT_OUT_DIR, args.agentId, args.agentRevisionId);
  await fs.mkdir(outDir, { recursive: true });
  const inspectArgs = [
    '--agent-id', args.agentId,
    '--revision', args.agentRevisionId,
    '--artifacts', path.join(SANDBOX_ARTIFACTS_DIR, args.agentRevisionId),
    '--manifest', path.join(PROJECT_ROOT, 'prompts', 'aisi', 'manifest.tier3.json'),
    '--enable-judge-panel',
    '--agent-card', path.join(SANDBOX_ARTIFACTS_DIR, args.agentRevisionId, 'agent_card.json'),
    '--judge-dry-run'
  ];
  await runInspectCli(inspectArgs);
  const summaryPath = path.join(outDir, 'judge', 'judge_summary.json');
  let summary: any = {};
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  } catch (err) {
    console.warn('[activities] judge summary missing', err);
  }
  return {
    verdict: summary.rejected && summary.rejected > 0 ? 'reject' : summary.manual && summary.manual > 0 ? 'manual' : 'approve',
    score: 0.9,
    explanation: summary.notes ?? 'Judge Panel result'
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
