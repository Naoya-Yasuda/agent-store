import { proxyActivities, setHandler, defineSignal, defineQuery } from '@temporalio/workflow';
import { TASK_QUEUE } from '../../temporal.config';

type Activities = {
  preCheckSubmission: (args: { submissionId: string }) => Promise<{ passed: boolean; agentId: string; agentRevisionId: string; warnings: string[] }>;
  runSecurityGate: (args: { submissionId: string; agentId: string; agentRevisionId: string; wandbRun?: WandbRunInfo }) => Promise<{ passed: boolean; artifactsPath: string; failReasons?: string[] }>;
  runFunctionalAccuracy: (args: { submissionId: string; agentId: string; agentRevisionId: string; wandbRun?: WandbRunInfo }) => Promise<{ passed: boolean; metrics: { embeddingVariance: number }; failReasons?: string[] }>;
  runJudgePanel: (args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string; wandbRun?: WandbRunInfo }) => Promise<{ verdict: 'approve' | 'reject' | 'manual'; score: number; explanation?: string }>;
  notifyHumanReview: (args: { submissionId: string; agentId: string; agentRevisionId: string; reason: string; attachments?: string[] }) => Promise<'approved' | 'rejected'>;
  publishAgent: (args: { submissionId: string; agentId: string; agentRevisionId: string }) => Promise<void>;
};

const activities = proxyActivities<Activities>({
  taskQueue: TASK_QUEUE,
  startToCloseTimeout: '1 minute'
});

type StageName = 'precheck' | 'security' | 'functional' | 'judge' | 'human' | 'publish';
type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type WorkflowTerminalState = 'running' | 'published' | 'rejected';

interface StageProgress {
  status: StageStatus;
  attempts: number;
  lastUpdatedSeq: number;
  message?: string;
  warnings?: string[];
}

interface WorkflowProgress {
  terminalState: WorkflowTerminalState;
  stages: Record<StageName, StageProgress>;
  wandbRun?: WandbRunInfo;
}

export interface WandbRunInfo {
  runId?: string;
  project?: string;
  entity?: string;
  baseUrl?: string;
  url?: string;
}

export interface ReviewPipelineInput {
  submissionId: string;
  promptVersion: string;
  agentRevisionId?: string;
  agentId?: string;
  wandbRun?: WandbRunInfo;
}

const retryStageSignal = defineSignal<[StageName, string]>('signalRetryStage');
const progressQuery = defineQuery<WorkflowProgress>('queryProgress');

export async function reviewPipelineWorkflow(input: ReviewPipelineInput): Promise<void> {
  const stageOrder: StageName[] = ['precheck', 'security', 'functional', 'judge', 'human', 'publish'];
  const stageProgress = stageOrder.reduce<Record<StageName, StageProgress>>((acc, stage) => {
    acc[stage] = { status: 'pending', attempts: 0, lastUpdatedSeq: 0 };
    return acc;
  }, {} as Record<StageName, StageProgress>);

  let terminalState: WorkflowTerminalState = 'running';
  let seqCounter = 0;
  const retryRequests = new Set<StageName>();

  setHandler(progressQuery, () => ({ terminalState, stages: stageProgress, wandbRun: input.wandbRun }));
  setHandler(retryStageSignal, (stage, reason) => {
    retryRequests.add(stage);
    updateStage(stage, { status: 'pending', message: `retry requested: ${reason}` });
  });

  const context = {
    submissionId: input.submissionId,
    promptVersion: input.promptVersion,
    agentId: input.agentId ?? '',
    agentRevisionId: input.agentRevisionId ?? '',
    wandbRun: input.wandbRun
  };

  function nextSeq(): number {
    seqCounter += 1;
    return seqCounter;
  }

  function updateStage(stage: StageName, updates: Partial<StageProgress>): void {
    stageProgress[stage] = {
      ...stageProgress[stage],
      ...updates,
      lastUpdatedSeq: nextSeq()
    };
  }

  async function runStage<T>(stage: StageName, fn: () => Promise<T>): Promise<T> {
    const attempts = stageProgress[stage].attempts + 1;
    updateStage(stage, { status: 'running', attempts, message: `attempt ${attempts}` });
    try {
      const result = await fn();
      updateStage(stage, { status: 'completed', message: 'completed' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'stage_failed';
      updateStage(stage, { status: 'failed', message });
      throw err;
    }
  }

  async function runStageWithRetry<T>(stage: StageName, fn: () => Promise<T>): Promise<T> {
    while (true) {
      const result = await runStage(stage, fn);
      if (!retryRequests.has(stage)) {
        return result;
      }
      retryRequests.delete(stage);
      updateStage(stage, { status: 'pending', message: 'retry scheduled' });
    }
  }

  async function escalateToHuman(reason: string, notes?: string[]): Promise<'approved' | 'rejected'> {
    const decision = await runStageWithRetry('human', () =>
      activities.notifyHumanReview({
        submissionId: context.submissionId,
        agentId: context.agentId,
        agentRevisionId: context.agentRevisionId,
        reason,
        attachments: notes
      })
    );
    updateStage('human', {
      status: decision === 'approved' ? 'completed' : 'failed',
      message: `human decision: ${decision}`
    });
    if (decision === 'rejected') {
      terminalState = 'rejected';
    } else {
      terminalState = 'running';
    }
    return decision;
  }

  function markPendingAsSkipped(): void {
    for (const stage of stageOrder) {
      if (stageProgress[stage].status === 'pending') {
        updateStage(stage, { status: 'skipped', message: 'not executed' });
      }
    }
  }

  try {
    const preCheck = await runStageWithRetry('precheck', () => activities.preCheckSubmission({ submissionId: context.submissionId }));
    updateStage('precheck', { warnings: preCheck.warnings, message: 'pre-check completed' });
    if (!preCheck.passed) {
      updateStage('precheck', { status: 'failed', message: 'pre-check rejected submission' });
      terminalState = 'rejected';
      return;
    }
    context.agentId = preCheck.agentId;
    context.agentRevisionId = preCheck.agentRevisionId;

    const security = await runStageWithRetry('security', () => activities.runSecurityGate({
      submissionId: context.submissionId,
      agentId: context.agentId,
      agentRevisionId: context.agentRevisionId,
      wandbRun: context.wandbRun
    }));
    if (!security.passed) {
      updateStage('security', { status: 'failed', message: security.failReasons?.join(', ') ?? 'security gate failed' });
      const decision = await escalateToHuman('security_gate_failure', security.failReasons);
      if (decision === 'rejected') {
        return;
      }
    }

    const functional = await runStageWithRetry('functional', () => activities.runFunctionalAccuracy({
      submissionId: context.submissionId,
      agentId: context.agentId,
      agentRevisionId: context.agentRevisionId,
      wandbRun: context.wandbRun
    }));
    if (!functional.passed) {
      updateStage('functional', { status: 'failed', message: functional.failReasons?.join(', ') ?? 'functional accuracy failed' });
      const decision = await escalateToHuman('functional_accuracy_failure', functional.failReasons);
      if (decision === 'rejected') {
        return;
      }
    }

    const judge = await runStageWithRetry('judge', () => activities.runJudgePanel({
      submissionId: context.submissionId,
      agentId: context.agentId,
      agentRevisionId: context.agentRevisionId,
      promptVersion: context.promptVersion,
      wandbRun: context.wandbRun
    }));
    updateStage('judge', { message: `judge verdict: ${judge.verdict}` });

    if (judge.verdict === 'reject') {
      updateStage('judge', { status: 'failed', message: judge.explanation ?? 'judge rejected submission' });
      terminalState = 'rejected';
      return;
    }

    if (judge.verdict === 'manual') {
      const decision = await escalateToHuman('judge_manual_review', judge.explanation ? [judge.explanation] : undefined);
      if (decision === 'rejected') {
        return;
      }
    }

    await runStageWithRetry('publish', () =>
      activities.publishAgent({
        submissionId: context.submissionId,
        agentId: context.agentId,
        agentRevisionId: context.agentRevisionId
      })
    );
    updateStage('publish', { message: 'agent published' });
    terminalState = 'published';
  } finally {
    markPendingAsSkipped();
  }
}
