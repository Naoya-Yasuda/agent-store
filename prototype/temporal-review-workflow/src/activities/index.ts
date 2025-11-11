import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { WandbRunInfo } from '../workflows/reviewPipeline.workflow';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'sandbox-runner', 'artifacts');

async function ensureSandboxArtifacts(agentRevisionId: string): Promise<string> {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  const stageDir = path.join(ARTIFACTS_DIR, agentRevisionId);
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
  return {
    passed: true,
    metrics: { embeddingVariance: 0.12 }
  };
}

export async function runJudgePanel(args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string; wandbRun?: WandbRunInfo }): Promise<{ verdict: 'approve' | 'reject' | 'manual'; score: number; explanation?: string }> {
  console.log(`[activities] runJudgePanel submission=${args.submissionId} prompt=${args.promptVersion}`);
  return {
    verdict: 'approve',
    score: 0.91,
    explanation: 'Placeholder judge approval'
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
