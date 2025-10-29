import { Connection, WorkflowClient } from '@temporalio/client';
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import path from 'path';
import { NAMESPACE } from '../temporal.config';

interface CliArgs {
  workflowId: string;
  runId?: string;
  output?: string;
  ledger?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const cliArgs: CliArgs = { workflowId: '' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workflow-id') {
      cliArgs.workflowId = args[++i];
    } else if (arg === '--run-id') {
      cliArgs.runId = args[++i];
    } else if (arg === '--output') {
      cliArgs.output = args[++i];
    } else if (arg === '--ledger') {
      cliArgs.ledger = args[++i];
    }
  }
  if (!cliArgs.workflowId) {
    console.error('Usage: pnpm ts-node src/exportHistory.ts --workflow-id <id> [--run-id <runId>] [--output <file>] [--ledger <file>]');
    process.exit(1);
  }
  return cliArgs;
}

async function main(): Promise<void> {
  const { workflowId, runId, output, ledger } = parseArgs();

  const connection = await Connection.connect();
  const client = new WorkflowClient({ connection, namespace: NAMESPACE });

  const handle = client.getHandle(workflowId, runId ? { runId } : undefined);
  const info = await handle.describe();
  const effectiveRunId = info.execution?.runId ?? runId;

  const historyResponse = await connection.workflowService.getWorkflowExecutionHistory({
    namespace: NAMESPACE,
    execution: {
      workflowId,
      runId: effectiveRunId
    }
  });

  const historyJson = JSON.stringify(historyResponse.history, null, 2);
  const hash = createHash('sha256').update(historyJson, 'utf8').digest('hex');

  const outputPath = output ?? path.join(process.cwd(), `${workflowId}-${effectiveRunId ?? 'latest'}-history.json`);
  writeFileSync(outputPath, historyJson, 'utf8');

  console.log(`Workflow history exported to ${outputPath}`);
  console.log(`SHA256: ${hash}`);

  if (ledger) {
    const ledgerEntry = {
      workflowId,
      runId: effectiveRunId ?? null,
      namespace: NAMESPACE,
      historyDigestSha256: hash,
      exportedAt: new Date().toISOString(),
      sourceFile: path.resolve(outputPath)
    };
    writeFileSync(ledger, JSON.stringify(ledgerEntry, null, 2), 'utf8');
    console.log(`Ledger entry written to ${ledger}`);
  }
}

main().catch((err) => {
  console.error('Failed to export history', err);
  process.exit(1);
});
