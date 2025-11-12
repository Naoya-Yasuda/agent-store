import { proxyActivities, setHandler, defineSignal, defineQuery, workflowInfo, condition } from '@temporalio/workflow';
import { TASK_QUEUE } from '../../temporal.config';

export type LlmJudgeConfig = {
  enabled?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  baseUrl?: string;
  dryRun?: boolean;
};

type SecurityGateResult = {
  passed: boolean;
  artifactsPath: string;
  summaryPath: string;
  reportPath: string;
  metadataPath: string;
  summary?: Record<string, unknown>;
  wandb?: WandbRunInfo;
  failReasons?: string[];
  ledgerEntryPath?: string;
  ledgerDigest?: string;
  ledgerSourceFile?: string;
  ledgerHttpPosted?: boolean;
  ledgerHttpAttempts?: number;
  ledgerHttpError?: string;
};

type FunctionalAccuracyResult = {
  passed: boolean;
  metrics: { averageDistance?: number; embeddingAverageDistance?: number; embeddingMaxDistance?: number };
  artifactsPath: string;
  summaryPath: string;
  reportPath: string;
  metadataPath: string;
  summary?: Record<string, unknown>;
  wandb?: WandbRunInfo;
  failReasons?: string[];
  ledgerEntryPath?: string;
  ledgerDigest?: string;
  ledgerSourceFile?: string;
  ledgerHttpPosted?: boolean;
  ledgerHttpAttempts?: number;
  ledgerHttpError?: string;
};

type JudgePanelResult = {
  verdict: 'approve' | 'reject' | 'manual';
  score: number;
  explanation?: string;
  artifactsPath: string;
  reportPath: string;
  summaryPath: string;
  relayLogPath: string;
  summary?: Record<string, unknown>;
  ledgerEntryPath?: string;
  ledgerDigest?: string;
  ledgerSourceFile?: string;
  ledgerHttpPosted?: boolean;
  ledgerHttpAttempts?: number;
  ledgerHttpError?: string;
};

type Activities = {
  preCheckSubmission: (args: { submissionId: string }) => Promise<{ passed: boolean; agentId: string; agentRevisionId: string; warnings: string[] }>;
  runSecurityGate: (args: { submissionId: string; agentId: string; agentRevisionId: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string } }) => Promise<SecurityGateResult>;
  runFunctionalAccuracy: (args: { submissionId: string; agentId: string; agentRevisionId: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string } }) => Promise<FunctionalAccuracyResult>;
  runJudgePanel: (args: { submissionId: string; agentId: string; agentRevisionId: string; promptVersion: string; workflowId: string; workflowRunId: string; wandbRun?: WandbRunInfo; agentCardPath?: string; relay?: { endpoint?: string; token?: string }; llmJudge?: LlmJudgeConfig }) => Promise<JudgePanelResult>;
  notifyHumanReview: (args: { submissionId: string; agentId: string; agentRevisionId: string; reason: string; attachments?: string[] }) => Promise<'approved' | 'rejected'>;
  recordStageEvent: (args: { agentRevisionId: string; stage: StageName; event: string; data?: Record<string, unknown>; timestamp?: string }) => Promise<void>;
  recordHumanDecisionMetadata: (args: { agentRevisionId: string; decision: 'approved' | 'rejected'; notes?: string; decidedAt?: string }) => Promise<void>;
  publishAgent: (args: { submissionId: string; agentId: string; agentRevisionId: string }) => Promise<void>;
};

const activities = proxyActivities<Activities>({
  taskQueue: TASK_QUEUE,
  startToCloseTimeout: '1 minute'
});

export type StageName = 'precheck' | 'security' | 'functional' | 'judge' | 'human' | 'publish';
type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type WorkflowTerminalState = 'running' | 'published' | 'rejected';

interface StageProgress {
  status: StageStatus;
  attempts: number;
  lastUpdatedSeq: number;
  message?: string;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export interface WorkflowProgress {
  terminalState: WorkflowTerminalState;
  stages: Record<StageName, StageProgress>;
  wandbRun?: WandbRunInfo;
  agentId?: string;
  agentRevisionId?: string;
  agentCardPath?: string;
  llmJudge?: LlmJudgeConfig;
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
  agentCardPath?: string;
  relay?: {
    endpoint?: string;
    token?: string;
  };
  wandbRun?: WandbRunInfo;
  llmJudge?: LlmJudgeConfig;
}

const retryStageSignal = defineSignal<[StageName, string]>('signalRetryStage');
const humanDecisionSignal = defineSignal<['approved' | 'rejected', string?]>('signalHumanDecision');
const updateLlmJudgeSignal = defineSignal<[LlmJudgeConfig]>('signalUpdateLlmJudge');
const progressQuery = defineQuery<WorkflowProgress>('queryProgress');

export async function reviewPipelineWorkflow(input: ReviewPipelineInput): Promise<void> {
  const info = workflowInfo();
  const stageOrder: StageName[] = ['precheck', 'security', 'functional', 'judge', 'human', 'publish'];
  const stageProgress = stageOrder.reduce<Record<StageName, StageProgress>>((acc, stage) => {
    acc[stage] = { status: 'pending', attempts: 0, lastUpdatedSeq: 0 };
    return acc;
  }, {} as Record<StageName, StageProgress>);

  let terminalState: WorkflowTerminalState = 'running';
  let seqCounter = 0;
  const retryRequests = new Set<StageName>();
  const retryReasons = new Map<StageName, string>();
  let pendingHumanDecision: { decision: 'approved' | 'rejected'; notes?: string } | undefined;

  const context = {
    submissionId: input.submissionId,
    promptVersion: input.promptVersion,
    agentId: input.agentId ?? '',
    agentRevisionId: input.agentRevisionId ?? '',
    agentCardPath: input.agentCardPath,
    relay: input.relay,
    wandbRun: input.wandbRun,
    llmJudge: input.llmJudge,
    workflowId: info.workflowId,
    workflowRunId: info.runId
  };

  function mergeWandbRun(current?: WandbRunInfo, next?: WandbRunInfo): WandbRunInfo | undefined {
    if (!next) {
      return current;
    }
    return {
      runId: next.runId ?? current?.runId,
      project: next.project ?? current?.project,
      entity: next.entity ?? current?.entity,
      baseUrl: next.baseUrl ?? current?.baseUrl,
      url: next.url ?? current?.url
    };
  }

  setHandler(progressQuery, () => ({
    terminalState,
    stages: stageProgress,
    wandbRun: context.wandbRun,
    agentId: context.agentId,
    agentRevisionId: context.agentRevisionId,
    agentCardPath: context.agentCardPath,
    llmJudge: context.llmJudge
  }));
  setHandler(retryStageSignal, (stage, reason) => {
    retryRequests.add(stage);
    retryReasons.set(stage, reason);
    updateStage(stage, { status: 'pending', message: `retry requested: ${reason}` });
  });
  setHandler(humanDecisionSignal, (decision, notes) => {
    pendingHumanDecision = { decision, notes };
    updateStage('human', {
      message: `human decision received: ${decision}`,
      details: {
        ...(stageProgress.human.details ?? {}),
        decision,
        decisionNotes: notes
      }
    });
  });
  setHandler(updateLlmJudgeSignal, (config) => {
    context.llmJudge = config;
    updateStage('judge', {
      message: 'llm config override received',
      details: {
        ...(stageProgress.judge.details ?? {}),
        llmJudge: config
      }
    });
    emitStageEvent('judge', 'llm_override_received', {
      enabled: config?.enabled,
      provider: config?.provider,
      model: config?.model,
      temperature: config?.temperature,
      maxOutputTokens: config?.maxOutputTokens,
      baseUrl: config?.baseUrl,
      dryRun: config?.dryRun
    }).catch((err) => console.warn('[workflow] failed to log llm override event', err));
  });

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

  function appendStageWarning(stage: StageName, warning: string): void {
    const warnings = [...(stageProgress[stage].warnings ?? []), warning];
    updateStage(stage, { warnings });
  }

  async function handleLedgerStatus(stage: StageName, ledgerInfo?: { ledgerHttpPosted?: boolean; ledgerHttpAttempts?: number; ledgerHttpError?: string }): Promise<void> {
    if (!ledgerInfo) {
      return;
    }
    if (ledgerInfo.ledgerHttpPosted === false || ledgerInfo.ledgerHttpError) {
      appendStageWarning(stage, 'Ledger upload failed: check network/endpoint');
      await emitStageEvent(stage, 'ledger_upload_failed', {
        attempts: ledgerInfo.ledgerHttpAttempts,
        error: ledgerInfo.ledgerHttpError
      });
    } else if (ledgerInfo.ledgerHttpPosted === true && ledgerInfo.ledgerHttpAttempts && ledgerInfo.ledgerHttpAttempts > 1) {
      await emitStageEvent(stage, 'ledger_upload_retry_succeeded', {
        attempts: ledgerInfo.ledgerHttpAttempts
      });
    }
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
      const reason = retryReasons.get(stage);
      retryReasons.delete(stage);
      await emitStageEvent(stage, 'retry_requested', {
        ...(reason ? { reason } : {}),
        attempts: stageProgress[stage].attempts
      });
      updateStage(stage, { status: 'pending', message: 'retry scheduled' });
    }
  }

  async function emitStageEvent(stage: StageName, event: string, data?: Record<string, unknown>): Promise<void> {
    if (!context.agentRevisionId) {
      return;
    }
    try {
      await activities.recordStageEvent({
        agentRevisionId: context.agentRevisionId,
        stage,
        event,
        data
      });
    } catch (err) {
      console.warn('[workflow] failed to record stage event', stage, event, err);
    }
  }

  async function escalateToHuman(sourceStage: StageName, reason: string, notes?: string[]): Promise<'approved' | 'rejected'> {
    await runStageWithRetry('human', () =>
      activities.notifyHumanReview({
        submissionId: context.submissionId,
        agentId: context.agentId,
        agentRevisionId: context.agentRevisionId,
        reason,
        attachments: notes
      })
    );
    await emitStageEvent(sourceStage, 'escalated_to_human', {
      reason,
      ...(notes ? { notes } : {})
    });
    updateStage('human', {
      status: 'running',
      message: 'waiting for human decision',
      details: {
        reason,
        attachments: notes
      }
    });
    await emitStageEvent('human', 'decision_pending', {
      sourceStage,
      reason
    });
    const decisionPayload = await waitForHumanDecision();
    const decision = decisionPayload.decision;
    const existingHumanDetails = stageProgress.human.details ?? {};
    updateStage('human', {
      status: decision === 'approved' ? 'completed' : 'failed',
      message: `human decision: ${decision}`,
      details: {
        ...existingHumanDetails,
        decision,
        decisionNotes: decisionPayload.notes
      }
    });
    if (context.agentRevisionId) {
      try {
        await activities.recordHumanDecisionMetadata({
          agentRevisionId: context.agentRevisionId,
          decision,
          notes: decisionPayload.notes,
          decidedAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn('[workflow] failed to record human decision metadata', err);
      }
    }
    if (decision === 'rejected') {
      terminalState = 'rejected';
    } else {
      terminalState = 'running';
    }
    return decision;
  }

  async function waitForHumanDecision(): Promise<{ decision: 'approved' | 'rejected'; notes?: string }> {
    await condition(() => pendingHumanDecision !== undefined);
    const result = pendingHumanDecision!;
    pendingHumanDecision = undefined;
    return result;
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
      workflowId: context.workflowId,
      workflowRunId: context.workflowRunId,
      wandbRun: context.wandbRun,
      agentCardPath: context.agentCardPath,
      relay: context.relay
    }));
    context.wandbRun = mergeWandbRun(context.wandbRun, security.wandb);
    updateStage('security', {
      details: {
        summary: security.summary,
        categories: (security.summary as any)?.categories,
        artifacts: {
          report: { stage: 'security', type: 'report', agentRevisionId: context.agentRevisionId },
          summary: { stage: 'security', type: 'summary', agentRevisionId: context.agentRevisionId },
          metadata: { stage: 'security', type: 'metadata', agentRevisionId: context.agentRevisionId },
          prompts: { stage: 'security', type: 'prompts', agentRevisionId: context.agentRevisionId }
        },
        ledger: security.ledgerEntryPath
          ? {
              entryPath: security.ledgerEntryPath,
              digest: security.ledgerDigest,
              sourceFile: security.ledgerSourceFile,
              httpPosted: security.ledgerHttpPosted,
              httpAttempts: security.ledgerHttpAttempts,
              httpError: security.ledgerHttpError
            }
          : undefined
      }
    });
    await handleLedgerStatus('security', security);
    if (!security.passed) {
      updateStage('security', { status: 'failed', message: security.failReasons?.join(', ') ?? 'security gate failed' });
      await emitStageEvent('security', 'stage_failed', {
        failReasons: security.failReasons
      });
      const decision = await escalateToHuman('security', 'security_gate_failure', security.failReasons);
      if (decision === 'rejected') {
        return;
      }
    }

    const functional = await runStageWithRetry('functional', () => activities.runFunctionalAccuracy({
      submissionId: context.submissionId,
      agentId: context.agentId,
      agentRevisionId: context.agentRevisionId,
      workflowId: context.workflowId,
      workflowRunId: context.workflowRunId,
      wandbRun: context.wandbRun,
      agentCardPath: context.agentCardPath,
      relay: context.relay
    }));
    context.wandbRun = mergeWandbRun(context.wandbRun, functional.wandb);
    updateStage('functional', {
      details: {
        metrics: functional.metrics,
        summary: functional.summary,
        artifacts: {
          report: { stage: 'functional', type: 'report', agentRevisionId: context.agentRevisionId },
          summary: { stage: 'functional', type: 'summary', agentRevisionId: context.agentRevisionId },
          prompts: { stage: 'functional', type: 'prompts', agentRevisionId: context.agentRevisionId }
        },
        ledger: functional.ledgerEntryPath
          ? {
              entryPath: functional.ledgerEntryPath,
              digest: functional.ledgerDigest,
              sourceFile: functional.ledgerSourceFile,
              httpPosted: functional.ledgerHttpPosted,
              httpAttempts: functional.ledgerHttpAttempts,
              httpError: functional.ledgerHttpError
            }
          : undefined
      }
    });
    await handleLedgerStatus('functional', functional);
    if (!functional.passed) {
      updateStage('functional', { status: 'failed', message: functional.failReasons?.join(', ') ?? 'functional accuracy failed' });
      await emitStageEvent('functional', 'stage_failed', {
        failReasons: functional.failReasons
      });
      const decision = await escalateToHuman('functional', 'functional_accuracy_failure', functional.failReasons);
      if (decision === 'rejected') {
        return;
      }
    }

    const judge = await runStageWithRetry('judge', () => activities.runJudgePanel({
      submissionId: context.submissionId,
      agentId: context.agentId,
      agentRevisionId: context.agentRevisionId,
      promptVersion: context.promptVersion,
      workflowId: context.workflowId,
      workflowRunId: context.workflowRunId,
      wandbRun: context.wandbRun,
      agentCardPath: context.agentCardPath,
      relay: context.relay,
      llmJudge: context.llmJudge
    }));
    const judgeSummary = judge.summary as Record<string, unknown> | undefined;
    const judgeLlm = (judgeSummary?.llmJudge as LlmJudgeConfig | undefined) ?? context.llmJudge;
    context.llmJudge = judgeLlm;
    updateStage('judge', {
      message: `judge verdict: ${judge.verdict}`,
      details: {
        summary: judge.summary,
        llmJudge: judgeLlm,
        artifacts: {
          report: { stage: 'judge', type: 'report', agentRevisionId: context.agentRevisionId, agentId: context.agentId },
          summary: { stage: 'judge', type: 'summary', agentRevisionId: context.agentRevisionId, agentId: context.agentId },
          relayLogs: { stage: 'judge', type: 'relay', agentRevisionId: context.agentRevisionId, agentId: context.agentId }
        },
        ledger: judge.ledgerEntryPath
          ? {
              entryPath: judge.ledgerEntryPath,
              digest: judge.ledgerDigest,
              sourceFile: judge.ledgerSourceFile,
              httpPosted: judge.ledgerHttpPosted,
              httpAttempts: judge.ledgerHttpAttempts,
              httpError: judge.ledgerHttpError
            }
          : undefined
      }
    });
    await handleLedgerStatus('judge', judge);

    if (judge.verdict === 'reject') {
      await emitStageEvent('judge', 'verdict_rejected', {
        score: judge.score,
        explanation: judge.explanation
      });
      updateStage('judge', { status: 'failed', message: judge.explanation ?? 'judge rejected submission' });
      terminalState = 'rejected';
      return;
    }

    if (judge.verdict === 'manual') {
      await emitStageEvent('judge', 'verdict_manual', {
        score: judge.score,
        explanation: judge.explanation
      });
      const decision = await escalateToHuman('judge', 'judge_manual_review', judge.explanation ? [judge.explanation] : undefined);
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
