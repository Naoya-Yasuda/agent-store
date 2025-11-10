import path from 'path';
import { promises as fs } from 'fs';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'sandbox-runner', 'artifacts');

async function ensureSandboxArtifacts(agentRevisionId: string): Promise<string> {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  const stageDir = path.join(ARTIFACTS_DIR, agentRevisionId);
  await fs.mkdir(stageDir, { recursive: true });
  const policyScorePath = path.join(stageDir, 'policy_score.json');
  const metadataPath = path.join(stageDir, 'metadata.json');

  await fs.writeFile(policyScorePath, JSON.stringify({ score: 0.95, evaluator: 'placeholder' }, null, 2), 'utf8');
  await fs.writeFile(metadataPath, JSON.stringify({ agentRevisionId }, null, 2), 'utf8');
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

export async function runSecurityGate(args: { submissionId: string; agentId: string; agentRevisionId: string }): Promise<{ passed: boolean; artifactsPath: string; failReasons?: string[] }> {
  console.log(`[activities] runSecurityGate submission=${args.submissionId}`);
  const artifactsPath = await ensureSandboxArtifacts(args.agentRevisionId);
  return {
    passed: true,
    artifactsPath
  };
}

export async function runFunctionalAccuracy(args: { submissionId: string; agentId: string; agentRevisionId: string }): Promise<{ passed: boolean; metrics: { embeddingVariance: number }; failReasons?: string[] }> {
  console.log(`[activities] runFunctionalAccuracy submission=${args.submissionId}`);
  return {
    passed: true,
    metrics: { embeddingVariance: 0.12 }
  };
}

export async function runJudgePanel(args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string }): Promise<{ verdict: 'approve' | 'reject' | 'manual'; score: number; explanation?: string }> {
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
