import { AgentCard } from '../../prototype/temporal-review-workflow/src/types/agentCard';
import { upsertAgentCard as repoUpsert, fetchAgentCards, fetchAgentCardByAgentId } from '../repositories/agentCardRepository';

export async function upsertAgentCard(card: AgentCard): Promise<void> {
  await repoUpsert(card);
}

export async function getAgentCards(): Promise<AgentCard[]> {
  return fetchAgentCards();
}

export async function getAgentCardByAgentId(agentId: string): Promise<AgentCard | undefined> {
  return fetchAgentCardByAgentId(agentId);
}
