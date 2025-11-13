import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { reviewPipelineWorkflow } from './workflows/reviewPipeline.workflow';
import { TASK_QUEUE } from '../temporal.config';

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    workflowsPath: require.resolve('./workflows/reviewPipeline.workflow'),
    activities,
    taskQueue: TASK_QUEUE
  });

  await worker.run();
}

run().catch((err) => {
  console.error('Worker failed', err);
  process.exit(1);
});
