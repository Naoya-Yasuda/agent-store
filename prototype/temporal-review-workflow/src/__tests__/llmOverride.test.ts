import { describe, it, expect } from 'vitest';
import { buildJudgeLlmArgs } from '../activities/index';

const baseConfig = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.5,
  maxOutputTokens: 512,
  baseUrl: 'https://example.invalid',
  dryRun: false
} as const;

describe('buildJudgeLlmArgs', () => {
  it('returns empty args when config is undefined', () => {
    expect(buildJudgeLlmArgs()).toEqual([]);
  });

  it('skips provider/model when enabled is false', () => {
    expect(buildJudgeLlmArgs({ ...baseConfig, enabled: false })).toEqual([]);
  });

  it('generates full flag set when enabled', () => {
    const args = buildJudgeLlmArgs(baseConfig);
    expect(args).toContain('--judge-llm-enabled');
    expect(args).toContain('--judge-llm-provider');
    expect(args).toContain('openai');
    expect(args).toContain('--judge-llm-model');
    expect(args).toContain('gpt-4o-mini');
    expect(args).toContain('--judge-llm-temperature');
    expect(args).toContain('0.5');
    expect(args).toContain('--judge-llm-max-output');
    expect(args).toContain('512');
    expect(args).toContain('--judge-llm-base-url');
    expect(args).toContain('https://example.invalid');
  });

  it('adds dry-run flag when requested', () => {
    const args = buildJudgeLlmArgs({ ...baseConfig, dryRun: true });
    expect(args).toContain('--judge-llm-dry-run');
  });
});
