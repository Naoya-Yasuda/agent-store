export type StageName = 'precheck' | 'security' | 'functional' | 'judge' | 'human' | 'publish';

export type LlmJudgeOverride = {
  enabled?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  baseUrl?: string;
  dryRun?: boolean;
};
