export async function fetchAgentDraft(agentRevisionId: string): Promise<{ agentId: string; riskTier: string }> {
  console.log(`[activities] fetchAgentDraft ${agentRevisionId}`);
  return { agentId: 'agent-123', riskTier: 'tier2' };
}

export async function runSandbox(agentRevisionId: string): Promise<{ latencyMs: number; policyScore: number; wandbRunId: string }> {
  console.log(`[activities] runSandbox ${agentRevisionId}`);
  return { latencyMs: 1200, policyScore: 0.95, wandbRunId: 'wandb-run-placeholder' };
}

export async function runAutoChecks(agentRevisionId: string): Promise<{ passed: boolean; checks: Record<string, boolean> }> {
  console.log(`[activities] runAutoChecks ${agentRevisionId}`);
  return { passed: true, checks: { schema: true, secrets: true } };
}

export async function invokeAISI(args: { agentRevisionId: string; promptVersion: string }): Promise<{ score: number; riskLabel: string }> {
  console.log(`[activities] invokeAISI ${args.agentRevisionId} prompt=${args.promptVersion}`);
  return { score: 0.9, riskLabel: 'medium' };
}

export async function triggerHumanReview(agentRevisionId: string, context: { aisiScore: number; riskLabel: string }): Promise<'approved' | 'rejected' | 'escalated'> {
  console.log(`[activities] triggerHumanReview ${agentRevisionId}`, context);
  return 'approved';
}

export async function publishAgent(agentRevisionId: string): Promise<void> {
  console.log(`[activities] publishAgent ${agentRevisionId}`);
}
