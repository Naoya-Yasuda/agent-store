export type LlmOverrideForm = {
  enabled: boolean;
  provider: string;
  model: string;
  temperature: string;
  maxTokens: string;
  baseUrl: string;
  dryRun: boolean | 'inherit';
};

export type LlmOverrideField = 'provider' | 'model' | 'temperature' | 'maxTokens' | 'baseUrl';

export type LlmOverrideResult = {
  override?: Record<string, unknown>;
  errors: string[];
  fieldErrors: Partial<Record<LlmOverrideField, string>>;
};

const MAX_TEMPERATURE = 2;
const MIN_TEMPERATURE = 0;
const MAX_TOKENS = 8192;

export function buildLlmOverride(config: LlmOverrideForm): LlmOverrideResult {
  if (!config.enabled) {
    return { override: undefined, errors: [], fieldErrors: {} };
  }
  const errors: string[] = [];
  const fieldErrors: Partial<Record<LlmOverrideField, string>> = {};
  const override: Record<string, unknown> = { enabled: true };

  if (!config.provider.trim()) {
    errors.push('プロバイダは必須です');
    fieldErrors.provider = 'プロバイダは必須です';
  } else {
    override.provider = config.provider.trim();
  }

  if (!config.model.trim()) {
    errors.push('モデル名は必須です');
    fieldErrors.model = 'モデル名は必須です';
  } else {
    override.model = config.model.trim();
  }

  if (config.temperature.trim().length > 0) {
    const value = Number(config.temperature);
    if (Number.isNaN(value) || value < MIN_TEMPERATURE || value > MAX_TEMPERATURE) {
      errors.push('温度は0.0〜2.0の数値で入力してください');
      fieldErrors.temperature = '0.0〜2.0の範囲で入力してください';
    } else {
      override.temperature = value;
    }
  }

  if (config.maxTokens.trim().length > 0) {
    const value = Number(config.maxTokens);
    if (!Number.isInteger(value) || value <= 0 || value > MAX_TOKENS) {
      errors.push(`Max Tokensは1〜${MAX_TOKENS}の整数で入力してください`);
      fieldErrors.maxTokens = `1〜${MAX_TOKENS}の整数で入力してください`;
    } else {
      override.maxOutputTokens = value;
    }
  }

  if (config.baseUrl.trim().length > 0) {
    if (!/^https?:\/\//i.test(config.baseUrl.trim())) {
      errors.push('Base URLはhttp(s)で始まる必要があります');
      fieldErrors.baseUrl = 'http(s)で始まるURLを入力してください';
    } else {
      override.baseUrl = config.baseUrl.trim();
    }
  }

  if (config.dryRun !== 'inherit') {
    override.dryRun = config.dryRun;
  }

  return { override: errors.length ? undefined : override, errors, fieldErrors };
}
