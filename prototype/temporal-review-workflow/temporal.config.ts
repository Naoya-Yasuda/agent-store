// Workflow-safe constants (can be imported in workflow code)
export const TASK_QUEUE = 'review-pipeline-task-queue';

// Client/Worker-side constants (should NOT be imported in workflow code)
// This uses process.env which is not available in workflow sandbox
export const NAMESPACE = typeof process !== 'undefined' && process.env ? (process.env.TEMPORAL_NAMESPACE ?? 'default') : 'default';
