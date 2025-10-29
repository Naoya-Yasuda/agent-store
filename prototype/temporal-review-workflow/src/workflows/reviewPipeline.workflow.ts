import { proxyActivities, condition, setHandler, defineSignal, defineQuery } from '@temporalio/workflow';
import { TASK_QUEUE } from '../../temporal.config';

// Activities interface definition
type Activities = {
  fetchAgentDraft: (agentRevisionId: string) => Promise<{ agentId: string; riskTier: string }>;
  runSandbox: (agentRevisionId: string) => Promise<{ latencyMs: number; policyScore: number; wandbRunId: string }>;
  runAutoChecks: (agentRevisionId: string) => Promise<{ passed: boolean; checks: Record<string, boolean> }>;
  invokeAISI: (args: { agentRevisionId: string; promptVersion: string }) => Promise<{ score: number; riskLabel: string }>;
  triggerHumanReview: (agentRevisionId: string, context: { aisiScore: number; riskLabel: string }) => Promise<'approved' | 'rejected' | 'escalated'>;
  publishAgent: (agentRevisionId: string) => Promise<void>;
};

const activities = proxyActivities<Activities>({
  taskQueue: TASK_QUEUE,
  startToCloseTimeout: '1 minute'
});

type WorkflowState = 'draft' | 'sandbox' | 'auto_checks' | 'aisi' | 'review' | 'published' | 'rejected' | 'escalated';

export interface ReviewPipelineInput {
  agentRevisionId: string;
  promptVersion: string;
}

const approveSignal = defineSignal('approve');
const rejectSignal = defineSignal('reject');
const escalateSignal = defineSignal('escalate');
const stateQuery = defineQuery<WorkflowState>('state');

export async function reviewPipelineWorkflow(input: ReviewPipelineInput): Promise<void> {
  let currentState: WorkflowState = 'draft';

  setHandler(stateQuery, () => currentState);
  setHandler(approveSignal, () => {
    currentState = 'published';
  });
  setHandler(rejectSignal, () => {
    currentState = 'rejected';
  });
  setHandler(escalateSignal, () => {
    currentState = 'escalated';
  });

  const { agentRevisionId, promptVersion } = input;

  await activities.fetchAgentDraft(agentRevisionId);
  currentState = 'sandbox';

  const sandboxResult = await activities.runSandbox(agentRevisionId);
  currentState = 'auto_checks';

  const checks = await activities.runAutoChecks(agentRevisionId);
  if (!checks.passed) {
    currentState = 'rejected';
    return;
  }

  currentState = 'aisi';
  const aisiResult = await activities.invokeAISI({ agentRevisionId, promptVersion });

  if (aisiResult.riskLabel === 'high') {
    currentState = 'escalated';
  } else {
    currentState = 'review';
  }

  const decision = await activities.triggerHumanReview(agentRevisionId, {
    aisiScore: aisiResult.score,
    riskLabel: aisiResult.riskLabel
  });

  if (decision === 'approved') {
    await activities.publishAgent(agentRevisionId);
    currentState = 'published';
  } else if (decision === 'rejected') {
    currentState = 'rejected';
  } else {
    // Wait for external signal to resolve escalation
    await condition(() => currentState === 'published' || currentState === 'rejected', '24 hours');
  }
}
