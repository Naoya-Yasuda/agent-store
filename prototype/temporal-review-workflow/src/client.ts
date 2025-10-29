import { Connection, WorkflowClient } from '@temporalio/client';
import { reviewPipelineWorkflow } from './workflows/reviewPipeline.workflow';
import { NAMESPACE } from '../temporal.config';

async function run(): Promise<void> {
  const connection = await Connection.connect();
  const client = new WorkflowClient({ connection, namespace: NAMESPACE });

  const handle = await client.start(reviewPipelineWorkflow, {
    taskQueue: 'review-pipeline-task-queue',
    workflowId: `review-pipeline-${Date.now()}`,
    args: [{ agentRevisionId: 'demo-rev-1', promptVersion: '2025.10.29-1' }]
  });

  console.log(`Started workflow ${handle.workflowId}`);

  await handle.result();

  console.log('Workflow completed');
}

run().catch((err) => {
  console.error('Client failed', err);
  process.exit(1);
});
