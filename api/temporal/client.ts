import { Connection, WorkflowClient } from '@temporalio/client';
import { ReviewPipelineInput, WandbRunInfo } from '../../prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow';
import { NAMESPACE } from '../../prototype/temporal-review-workflow/temporal.config';

let workflowClient: WorkflowClient | undefined;

async function getWorkflowClient(): Promise<WorkflowClient> {
  if (workflowClient) {
    return workflowClient;
  }
  const connection = await Connection.connect();
  workflowClient = new WorkflowClient({ connection, namespace: NAMESPACE });
  return workflowClient;
}

export async function getWorkflowProgress(submissionId: string): Promise<{ terminalState: string; stages: Record<string, unknown>; wandbRun?: WandbRunInfo } | undefined> {
  const client = await getWorkflowClient();
  const handle = client.getHandle(`review-pipeline-${submissionId}`);
  return handle.query('queryProgress');
}

export async function sendRetrySignal(submissionId: string, stage: string, reason: string): Promise<void> {
  const client = await getWorkflowClient();
  const handle = client.getHandle(`review-pipeline-${submissionId}`);
  await handle.signal('signalRetryStage', stage as any, reason);
}

export async function sendHumanDecision(submissionId: string, decision: 'approved' | 'rejected', notes?: string): Promise<void> {
  const client = await getWorkflowClient();
  const handle = client.getHandle(`review-pipeline-${submissionId}`);
  await handle.signal('signalRetryStage', 'human', `decision:${decision}:${notes ?? ''}`);
}

export async function startReviewWorkflow(input: ReviewPipelineInput): Promise<void> {
  const client = await getWorkflowClient();
  await client.start('reviewPipelineWorkflow', {
    taskQueue: 'review-pipeline-task-queue',
    workflowId: `review-pipeline-${input.submissionId}`,
    args: [input]
  });
}
