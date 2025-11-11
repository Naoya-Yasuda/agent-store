import { describe, it, expect } from 'vitest';
import { buildLlmOverride } from '../src/lib/judgeOverride';

describe('buildLlmOverride', () => {
  const base = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o',
    temperature: '',
    maxTokens: '',
    baseUrl: '',
    dryRun: 'inherit' as const
  };

  it('returns undefined override when disabled', () => {
    const result = buildLlmOverride({ ...base, enabled: false });
    expect(result.override).toBeUndefined();
    expect(result.errors).toHaveLength(0);
  });

  it('requires provider and model when enabled', () => {
    const result = buildLlmOverride({ ...base, provider: '', model: '' });
    expect(result.override).toBeUndefined();
    expect(result.errors).toContain('プロバイダは必須です');
    expect(result.errors).toContain('モデル名は必須です');
  });

  it('validates temperature range', () => {
    const result = buildLlmOverride({ ...base, temperature: '3' });
    expect(result.override).toBeUndefined();
    expect(result.errors).toContain('温度は0.0〜2.0の数値で入力してください');
  });

  it('validates max tokens range', () => {
    const result = buildLlmOverride({ ...base, maxTokens: '-5' });
    expect(result.override).toBeUndefined();
    expect(result.errors).toContain('Max Tokensは1〜8192の整数で入力してください');
  });

  it('builds override when values are valid', () => {
    const result = buildLlmOverride({
      ...base,
      temperature: '0.5',
      maxTokens: '512',
      baseUrl: 'https://example.com',
      dryRun: true
    });
    expect(result.errors).toHaveLength(0);
    expect(result.override).toMatchObject({
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
      maxOutputTokens: 512,
      baseUrl: 'https://example.com',
      dryRun: true
    });
  });
});
