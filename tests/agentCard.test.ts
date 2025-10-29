import { validateAgentCardPayload } from '../api/utils/agentCardValidator';

describe('AgentCard validation', () => {
  it('accepts valid payload', () => {
    const result = validateAgentCardPayload({
      id: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
      locale: 'ja-JP',
      displayName: 'サンプルエージェント',
      shortDescription: '説明テキスト',
      capabilities: ['検索'],
      status: 'draft'
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid payload', () => {
    const result = validateAgentCardPayload({
      id: 'bad-id'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });
});
