'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLlmOverride, LlmOverrideResult } from '../src/lib/judgeOverride';
import { TrustScoreCard } from '../src/components/TrustScoreCard';

type StageName = 'precheck' | 'security' | 'functional' | 'judge' | 'human' | 'publish';

type ArtifactDescriptor = {
  stage: StageName | string;
  type: string;
  agentRevisionId: string;
  agentId?: string;
};

type LlmJudgeConfig = {
  enabled?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  baseUrl?: string;
  dryRun?: boolean;
};

type StageDetails = {
  summary?: unknown;
  metrics?: Record<string, unknown>;
  artifacts?: Record<string, ArtifactDescriptor>;
  llmJudge?: LlmJudgeConfig;
  categories?: Record<string, number>;
  reason?: string;
  ledger?: {
    entryPath?: string;
    digest?: string;
    sourceFile?: string;
    httpPosted?: boolean;
    httpAttempts?: number;
    httpError?: string;
    downloadAvailable?: boolean;
    downloadFallback?: boolean;
    downloadRelativePath?: string;
    downloadStatus?: 'primary' | 'fallback';
    downloadMissingReason?: string;
  };
};

type StageInfo = {
  status: string;
  attempts: number;
  message?: string;
  warnings?: string[];
  lastUpdatedSeq?: number;
  details?: StageDetails;
};

type WandbInfo = {
  url?: string;
  runId?: string;
  project?: string;
  entity?: string;
};

type TrustScoreBreakdown = {
  security: number;
  functional: number;
  judge: number;
  implementation: number;
  total: number;
  autoDecision: 'auto_approved' | 'auto_rejected' | 'requires_human_review';
  reasoning: {
    security?: string;
    functional?: string;
    judge?: string;
    implementation?: string;
  };
};

type ProgressResponse = {
  terminalState: string;
  stages: Record<StageName, StageInfo>;
  wandbRun?: WandbInfo;
  agentId?: string;
  agentRevisionId?: string;
  llmJudge?: LlmJudgeConfig;
  warnings?: Record<StageName, string[]>;
  trustScore?: TrustScoreBreakdown;
};

type ArtifactState = {
  loading: boolean;
  error?: string;
  data?: unknown;
  raw?: string;
};

type LedgerEntrySummary = {
  stage: StageName;
  entryPath?: string;
  digest?: string;
  workflowId?: string;
  workflowRunId?: string;
  generatedAt?: string;
  downloadUrl?: string;
  sourceFile?: string;
  httpPosted?: boolean;
  httpAttempts?: number;
  httpError?: string;
  downloadAvailable?: boolean;
  downloadFallback?: boolean;
  downloadRelativePath?: string;
  downloadStatus?: 'primary' | 'fallback' | 'remote';
  downloadMissingReason?: string;
  remoteStatusCode?: number;
  remoteLatencyMs?: number;
  remoteReachable?: boolean;
  remoteError?: string;
};

type StageEventEntry = {
  id: string;
  stage: string;
  event: string;
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  severity?: 'info' | 'warn' | 'error';
};

const stageOrder: StageName[] = ['precheck', 'security', 'functional', 'judge', 'human', 'publish'];
const stageLabels: Record<StageName, string> = {
  precheck: 'PreCheck',
  security: 'Security Gate',
  functional: 'Functional Accuracy',
  judge: 'Judge Panel',
  human: 'Human Review',
  publish: 'Publish'
};

const stageIcons: Record<StageName, string> = {
  precheck: '🧾',
  security: '🛡️',
  functional: '🧪',
  judge: '⚖️',
  human: '🙋',
  publish: '🚀'
};

const evidenceStageOptions: { stage: StageName; artifacts: string[] }[] = [
  { stage: 'security', artifacts: ['summary', 'report', 'metadata', 'prompts'] },
  { stage: 'functional', artifacts: ['summary', 'report'] },
  { stage: 'judge', artifacts: ['summary', 'report', 'relay'] }
];

type EmbeddingHistogramBucket = {
  label: string;
  count: number;
  min: number;
  max: number | null;
};

const EMBEDDING_BUCKETS: ReadonlyArray<{ min: number; max: number | null }> = [
  { min: 0, max: 0.1 },
  { min: 0.1, max: 0.25 },
  { min: 0.25, max: 0.5 },
  { min: 0.5, max: 0.75 },
  { min: 0.75, max: 1 },
  { min: 1, max: null }
];

function buildEmbeddingHistogram(values: number[]): EmbeddingHistogramBucket[] {
  if (!values.length) {
    return [];
  }
  return EMBEDDING_BUCKETS.map(({ min, max }) => {
    const count = values.filter((value) => value >= min && (max === null ? true : value < max)).length;
    return {
      label: formatBucketLabel(min, max),
      count,
      min,
      max
    };
  }).filter((bucket) => bucket.count > 0);
}

function formatBucketLabel(min: number, max: number | null): string {
  const minLabel = min.toFixed(2);
  const maxLabel = max === null ? '∞' : max.toFixed(2);
  return `${minLabel}〜${maxLabel}`;
}

export default function ReviewDashboard() {
  const [submissionId, setSubmissionId] = useState('demo');
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryStage, setRetryStage] = useState<StageName>('security');
  const [retryReason, setRetryReason] = useState('');
  const [llmOverrideEnabled, setLlmOverrideEnabled] = useState(false);
  const [retryLlmProvider, setRetryLlmProvider] = useState('');
  const [retryLlmModel, setRetryLlmModel] = useState('');
  const [retryLlmTemperature, setRetryLlmTemperature] = useState('');
  const [retryLlmMaxTokens, setRetryLlmMaxTokens] = useState('');
  const [retryLlmBaseUrl, setRetryLlmBaseUrl] = useState('');
  const [retryLlmDryRun, setRetryLlmDryRun] = useState<boolean | 'inherit'>('inherit');
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const [selectedEvidenceStage, setSelectedEvidenceStage] = useState<StageName>('security');
  const [selectedArtifactType, setSelectedArtifactType] = useState('summary');
  const [artifactStates, setArtifactStates] = useState<Record<string, ArtifactState>>({});
  const [relaySearchTerm, setRelaySearchTerm] = useState('');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntrySummary[]>([]);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerCopyStage, setLedgerCopyStage] = useState<StageName | null>(null);
  const [ledgerCopyError, setLedgerCopyError] = useState<string | null>(null);
  const [stageEvents, setStageEvents] = useState<StageEventEntry[]>([]);
  const [stageEventError, setStageEventError] = useState<string | null>(null);
  const [eventStageFilter, setEventStageFilter] = useState<'all' | StageName>('all');
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [judgeCardLimit, setJudgeCardLimit] = useState(12);
  const [showRelayErrorsOnly, setShowRelayErrorsOnly] = useState(false);
  const [functionalSearchTerm, setFunctionalSearchTerm] = useState('');
  const [embeddingAlertThreshold, setEmbeddingAlertThreshold] = useState(0.5);
  const [ledgerActionStatus, setLedgerActionStatus] = useState<Record<StageName, string | undefined>>({} as Record<StageName, string | undefined>);
  const manualSectionRef = useRef<HTMLDivElement | null>(null);
  const judgeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [focusedJudgeQuestion, setFocusedJudgeQuestion] = useState<string | null>(null);
  const artifactSectionRef = useRef<HTMLDivElement | null>(null);
  const focusArtifact = useCallback((stage: StageName, type: string) => {
    setSelectedEvidenceStage(stage);
    setSelectedArtifactType(type);
    setTimeout(() => {
      artifactSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }, []);

  const llmOverrideResult = useMemo<LlmOverrideResult>(() => {
    if (!llmOverrideEnabled) {
      return { override: undefined, errors: [], fieldErrors: {} };
    }
    return buildLlmOverride({
      enabled: llmOverrideEnabled,
      provider: retryLlmProvider,
      model: retryLlmModel,
      temperature: retryLlmTemperature,
      maxTokens: retryLlmMaxTokens,
      baseUrl: retryLlmBaseUrl,
      dryRun: retryLlmDryRun
    });
  }, [llmOverrideEnabled, retryLlmProvider, retryLlmModel, retryLlmTemperature, retryLlmMaxTokens, retryLlmBaseUrl, retryLlmDryRun]);

  const llmOverrideErrors = llmOverrideEnabled ? llmOverrideResult.errors : [];
  const llmFieldErrors = llmOverrideEnabled ? llmOverrideResult.fieldErrors : {};
  const llmOverridePayload = llmOverrideEnabled ? llmOverrideResult.override : undefined;
  const isRetryDisabled = useMemo(() => {
    if (!retryReason.trim()) {
      return true;
    }
    if (retryStage === 'judge' && llmOverrideEnabled && !llmOverridePayload) {
      return true;
    }
    return false;
  }, [llmOverrideEnabled, llmOverridePayload, retryReason, retryStage]);

  const filteredStageEvents = useMemo(() => {
    const keyword = eventSearchTerm.trim().toLowerCase();
    return stageEvents.filter((evt) => {
      if (eventStageFilter !== 'all' && evt.stage !== eventStageFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = `${evt.stage} ${evt.event} ${evt.type ?? ''} ${JSON.stringify(evt.data ?? {})}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [stageEvents, eventSearchTerm, eventStageFilter]);

  const fetchProgress = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/review/progress/${submissionId}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data: ProgressResponse = await res.json();
      setProgress(data);
      setRetryStage('security');
      setLedgerEntries([]);
      setLedgerError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  const applyLlmOverridePreset = useCallback((source?: Partial<LlmJudgeConfig>) => {
    if (!source) {
      return;
    }
    setLlmOverrideEnabled(true);
    setRetryLlmProvider(source.provider ?? '');
    setRetryLlmModel(source.model ?? '');
    if (typeof source.temperature === 'number') {
      setRetryLlmTemperature(String(source.temperature));
    } else if (typeof (source as any)?.temperature === 'string') {
      setRetryLlmTemperature((source as any).temperature as string);
    }
    if (typeof source.maxOutputTokens === 'number') {
      setRetryLlmMaxTokens(String(source.maxOutputTokens));
    } else if (typeof (source as any)?.maxOutputTokens === 'string') {
      setRetryLlmMaxTokens((source as any).maxOutputTokens as string);
    }
    setRetryLlmBaseUrl(source.baseUrl ?? '');
    if (typeof source.dryRun === 'boolean') {
      setRetryLlmDryRun(source.dryRun);
    } else {
      setRetryLlmDryRun('inherit');
    }
  }, []);

  useEffect(() => {
    setJudgeCardLimit(12);
  }, [submissionId, progress?.agentRevisionId]);

  useEffect(() => {
    if (retryStage !== 'judge') {
      setLlmOverrideEnabled(false);
    }
  }, [retryStage]);

  const refreshLedgerEntries = useCallback(async (signal?: AbortSignal) => {
    if (!progress) {
      setLedgerEntries([]);
      setLedgerError(null);
      return;
    }
    try {
      const res = await fetch(`/review/ledger/${submissionId}`, { signal });
      if (res.status === 404) {
        setLedgerEntries([]);
        setLedgerError(null);
        return;
      }
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const payload = await res.json();
      setLedgerEntries(payload.entries ?? []);
      setLedgerError(null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setLedgerError(err instanceof Error ? err.message : 'ledger_fetch_failed');
      }
    }
  }, [progress, submissionId]);

  useEffect(() => {
    if (!progress) {
      setLedgerEntries([]);
      return;
    }
    const controller = new AbortController();
    refreshLedgerEntries(controller.signal);
    return () => controller.abort();
  }, [progress, refreshLedgerEntries]);

  const copyLedgerPath = useCallback(async (stage: StageName, value?: string) => {
    if (!value) {
      setLedgerCopyError('コピーするパスがありません');
      return;
    }
    if (!navigator?.clipboard) {
      setLedgerCopyError('このブラウザではコピー機能を利用できません');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setLedgerCopyStage(stage);
      setLedgerCopyError(null);
      setTimeout(() => {
        setLedgerCopyStage((current) => (current === stage ? null : current));
      }, 1500);
    } catch (err) {
      console.error('failed to copy ledger path', err);
      setLedgerCopyError('クリップボードへのコピーに失敗しました');
    }
  }, []);

  const handleLedgerResend = useCallback(async (stage: StageName) => {
    setLedgerActionStatus((prev) => ({ ...prev, [stage]: '再送中...' }));
    try {
      const res = await fetch('/review/ledger/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, stage })
      });
      const payload = await res.json();
      setLedgerActionStatus((prev) => ({ ...prev, [stage]: res.ok ? '再送成功' : payload.error ?? '失敗しました' }));
      if (res.ok) {
        await refreshLedgerEntries();
      }
    } catch (err) {
      setLedgerActionStatus((prev) => ({ ...prev, [stage]: err instanceof Error ? err.message : '通信エラー' }));
    } finally {
      setTimeout(() => {
        setLedgerActionStatus((prev) => {
          const next = { ...prev };
          delete next[stage];
          return next;
        });
      }, 4000);
    }
  }, [refreshLedgerEntries, submissionId]);

  useEffect(() => {
    if (!progress) {
      setStageEvents([]);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/review/events/${submissionId}`, { signal: controller.signal });
        if (res.status === 404) {
          setStageEvents([]);
          setStageEventError(null);
          return;
        }
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const payload = await res.json();
        const events: StageEventEntry[] = Array.isArray(payload.events) ? payload.events : [];
        events.sort((a, b) => {
          const at = a.timestamp ? Date.parse(a.timestamp) : 0;
          const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
          return bt - at;
        });
        setStageEvents(events);
        setStageEventError(null);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setStageEventError(err instanceof Error ? err.message : 'events_fetch_failed');
        }
      }
    })();
    return () => controller.abort();
  }, [progress, submissionId]);

  useEffect(() => {
    if (!progress?.llmJudge) {
      setRetryLlmProvider('');
      setRetryLlmModel('');
      setRetryLlmTemperature('');
      setRetryLlmMaxTokens('');
      setRetryLlmBaseUrl('');
      setRetryLlmDryRun('inherit');
      return;
    }
    const llm = progress.llmJudge;
    setRetryLlmProvider(llm.provider ?? '');
    setRetryLlmModel(llm.model ?? '');
    setRetryLlmTemperature(typeof llm.temperature === 'number' ? String(llm.temperature) : '');
    setRetryLlmMaxTokens(typeof llm.maxOutputTokens === 'number' ? String(llm.maxOutputTokens) : '');
    setRetryLlmBaseUrl(llm.baseUrl ?? '');
    setRetryLlmDryRun(typeof llm.dryRun === 'boolean' ? llm.dryRun : 'inherit');
  }, [progress?.llmJudge]);

  useEffect(() => {
    const option = evidenceStageOptions.find((opt) => opt.stage === selectedEvidenceStage);
    if (option && !option.artifacts.includes(selectedArtifactType)) {
      setSelectedArtifactType(option.artifacts[0]);
    }
  }, [selectedEvidenceStage, selectedArtifactType]);

  const buildArtifactUrl = useCallback((descriptor: ArtifactDescriptor) => {
    const params = new URLSearchParams({ stage: descriptor.stage, type: descriptor.type });
    if (descriptor.agentId) {
      params.set('agentId', descriptor.agentId);
    }
    return `/review/artifacts/${descriptor.agentRevisionId}?${params.toString()}`;
  }, []);

  const loadArtifact = useCallback(async (descriptor: ArtifactDescriptor | undefined, cacheKey: string) => {
    if (!descriptor) {
      setArtifactStates((prev) => ({
        ...prev,
        [cacheKey]: { loading: false, error: '該当アーティファクトが見つかりません' }
      }));
      return;
    }
    setArtifactStates((prev) => ({ ...prev, [cacheKey]: { loading: true } }));
    try {
      const res = await fetch(buildArtifactUrl(descriptor));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const contentType = res.headers.get('content-type') ?? '';
      const text = await res.text();
      let parsed: unknown = text;
      if (contentType.includes('application/json')) {
        parsed = JSON.parse(text);
      } else {
        const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length) {
          const jsonl = lines.map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });
          parsed = jsonl;
        }
      }
      setArtifactStates((prev) => ({
        ...prev,
        [cacheKey]: { loading: false, data: parsed, raw: text }
      }));
    } catch (err) {
      setArtifactStates((prev) => ({
        ...prev,
        [cacheKey]: { loading: false, error: err instanceof Error ? err.message : 'fetch_failed' }
      }));
    }
  }, [buildArtifactUrl]);

  useEffect(() => {
    if (!progress?.stages?.judge?.details?.artifacts) {
      return;
    }
    const judgeArtifacts = progress.stages.judge.details.artifacts;
    (['summary', 'report', 'relay'] as const).forEach((artifactKey) => {
      const descriptor = judgeArtifacts[artifactKey];
      const cacheKey = `judge:${artifactKey}`;
      if (descriptor && !artifactStates[cacheKey]) {
        loadArtifact(descriptor, cacheKey);
      }
    });
  }, [artifactStates, loadArtifact, progress]);

  const judgeArtifactLinks = useMemo(() => {
    const descriptors = progress?.stages?.judge?.details?.artifacts;
    if (!descriptors) {
      return {} as Record<string, string | undefined>;
    }
    return {
      summary: descriptors.summary ? buildArtifactUrl(descriptors.summary) : undefined,
      report: descriptors.report ? buildArtifactUrl(descriptors.report) : undefined,
      relay: descriptors.relay ? buildArtifactUrl(descriptors.relay) : undefined
    };
  }, [buildArtifactUrl, progress?.stages?.judge?.details?.artifacts]);

  useEffect(() => {
    const functionalArtifacts = progress?.stages?.functional?.details?.artifacts;
    if (!functionalArtifacts) {
      return;
    }
    const descriptor = functionalArtifacts.report;
    if (descriptor && !artifactStates['functional:report']) {
      loadArtifact(descriptor, 'functional:report');
    }
  }, [artifactStates, loadArtifact, progress]);

  const handleRetry = async () => {
    const trimmedReason = retryReason.trim();
    if (!trimmedReason) {
      setRetryStatus('理由を入力してください');
      return;
    }
    setRetryStatus('送信中...');
    try {
      const body: Record<string, unknown> = { submissionId, stage: retryStage, reason: trimmedReason };
      if (retryStage === 'judge') {
        if (llmOverrideEnabled && !llmOverridePayload) {
          setRetryStatus('LLM設定のエラーを修正してください');
          return;
        }
        if (llmOverridePayload) {
          body.llmOverride = llmOverridePayload;
        }
      }
      const res = await fetch('/review/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json();
      setRetryStatus(res.ok ? '再実行を依頼しました' : payload.error ?? '失敗しました');
    } catch (err) {
      setRetryStatus(err instanceof Error ? err.message : '通信エラー');
    }
  };

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    setDecisionStatus('送信中...');
    try {
      const res = await fetch('/review/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, decision, notes: decisionNotes })
      });
      const payload = await res.json();
      setDecisionStatus(res.ok ? '決定を送信しました' : payload.error ?? '失敗しました');
    } catch (err) {
      setDecisionStatus(err instanceof Error ? err.message : '通信エラー');
    }
  };

  const renderArtifactViewer = () => {
    if (!progress) {
      return <p>進捗情報が未取得です。</p>;
    }
    const stageInfo = progress.stages[selectedEvidenceStage];
    const descriptor = stageInfo?.details?.artifacts?.[selectedArtifactType];
    const cacheKey = `${selectedEvidenceStage}:${selectedArtifactType}`;
    const artifactState = artifactStates[cacheKey];

    return (
      <section ref={artifactSectionRef} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button
            onClick={() => loadArtifact(descriptor, cacheKey)}
            disabled={!descriptor}
          >
            {artifactState?.loading ? '取得中...' : 'APIから再取得'}
          </button>
          {descriptor && (
            <a href={buildArtifactUrl(descriptor)} target="_blank" rel="noreferrer">
              ダウンロード
            </a>
          )}
          {artifactState?.error && <span style={{ color: 'red' }}>{artifactState.error}</span>}
        </div>
        {artifactState?.data ? (
          <pre style={{ maxHeight: 360, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 6 }}>
            {JSON.stringify(artifactState.data, null, 2)}
          </pre>
        ) : stageInfo?.details?.summary ? (
          <pre style={{ maxHeight: 360, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 6 }}>
            {JSON.stringify(stageInfo.details.summary, null, 2)}
          </pre>
        ) : (
          <p>アーティファクトがまだ取得されていません。</p>
        )}
      </section>
    );
  };

  const renderJudgeInsights = () => {
    if (selectedEvidenceStage !== 'judge' || !progress) {
      return null;
    }
    const judgeDetails = progress.stages.judge?.details;
    const summary = (judgeDetails?.summary as Record<string, any>) ?? {};
    const llm = judgeDetails?.llmJudge ?? progress.llmJudge;
    const reportData = (artifactStates['judge:report']?.data as any[]) ?? [];
    const relayData = (artifactStates['judge:relay']?.data as any[]) ?? [];
    const relayTerm = relaySearchTerm.trim().toLowerCase();
    const relayBase = showRelayErrorsOnly ? relayData.filter((item) => item?.error) : relayData;
    const filteredRelay = relayTerm
      ? relayBase.filter((item) => JSON.stringify(item).toLowerCase().includes(relayTerm))
      : relayBase;
    const relayErrorCount = relayData.filter((item) => item?.error).length;
    const displayedReport = reportData.slice(0, Math.min(judgeCardLimit, reportData.length));
    const hasMoreCards = reportData.length > judgeCardLimit;
    const llmOverrideHistory = stageEvents.filter((evt) => evt.stage === 'judge' && evt.event === 'llm_override_received');
    const manualRecords = reportData.filter((item) => item.verdict === 'manual');
    const rejectedRecords = reportData.filter((item) => item.verdict === 'reject');
    const totalQuestions = summary.questions ?? 0;
    const questionSources = Array.from(new Set(reportData.map((item) => (item?.source ?? 'agent_card')).filter(Boolean)));
    const manualCount = summary.manual ?? 0;
    const rejectedCount = summary.rejected ?? 0;
    const flaggedCount = summary.flagged ?? 0;
    const llmCallCount = summary.llmCallCount ?? summary.llm_calls ?? 0;
    const summaryRelayErrors = summary.relayErrorCount ?? summary.relayErrors ?? summary.relay_error_count ?? 0;
    const scoreBreakdown = {
      taskCompletion: summary.taskCompletion ?? summary.task_completion ?? summary.task_completion_score,
      toolUsage: summary.toolCorrectness ?? summary.tool_usage ?? summary.tool_correctness,
      autonomy: summary.autonomy ?? summary.autonomy_score,
      safety: summary.safety ?? summary.safety_score,
      totalScore: summary.totalScore ?? summary.total_score
    };
    const judgeStage = progress.stages.judge;
    const verdict = typeof summary.verdict === 'string' ? summary.verdict : undefined;
    const awaitingHuman = progress.stages.human?.details?.reason === 'judge_manual_review';
    const manualBannerVisible = verdict === 'manual' || awaitingHuman || manualRecords.length > 0;
    const manualReason = summary.manualReason || judgeStage?.message;
    const primaryManualId = manualRecords[0]?.questionId;
    const handleManualRetry = (questionId?: string) => {
      handlePrefillRetry(`judge manual follow-up: ${questionId ?? 'manual review'}`);
      setLlmOverrideEnabled(true);
    };
    const jumpToManualList = () => {
      manualSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const scrollToJudgeCard = (questionId?: string) => {
      if (!questionId) return;
      setFocusedJudgeQuestion(questionId);
      setTimeout(() => {
        const target = judgeCardRefs.current[questionId];
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    };
    const focusJudgeEvidence = (questionId?: string) => {
      setSelectedEvidenceStage('judge');
      setSelectedArtifactType('report');
      setRelaySearchTerm(questionId ?? '');
      setShowRelayErrorsOnly(false);
      setTimeout(() => {
        artifactSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    };

    const presetOverrideFromCard = (item: Record<string, any>) => {
      const overrideSource: Partial<LlmJudgeConfig> = {
        provider: item.llmProvider ?? item.provider ?? llm?.provider,
        model: item.llmModel ?? item.model ?? llm?.model,
        temperature: typeof item.llmTemperature === 'number' ? item.llmTemperature : llm?.temperature,
        maxOutputTokens: typeof item.llmMaxOutputTokens === 'number' ? item.llmMaxOutputTokens : llm?.maxOutputTokens,
        baseUrl: item.llmBaseUrl ?? llm?.baseUrl,
        dryRun: typeof item.llmDryRun === 'boolean' ? item.llmDryRun : llm?.dryRun
      };
      applyLlmOverridePreset(overrideSource);
      handlePrefillRetry(`judge manual follow-up: ${item.questionId}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const parseMaybeNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number' && !Number.isNaN(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
      return undefined;
    };

    const presetOverrideFromEvent = (evtData: Record<string, unknown> | undefined) => {
      if (!evtData) return;
      const overrideSource: Partial<LlmJudgeConfig> = {
        provider: typeof evtData.provider === 'string' ? evtData.provider : undefined,
        model: typeof evtData.model === 'string' ? evtData.model : undefined,
        temperature: parseMaybeNumber(evtData.temperature),
        maxOutputTokens: parseMaybeNumber(evtData.maxOutputTokens),
        baseUrl: typeof evtData.baseUrl === 'string' ? evtData.baseUrl : undefined,
        dryRun: typeof evtData.dryRun === 'boolean' ? evtData.dryRun : undefined
      };
      applyLlmOverridePreset(overrideSource);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Judge 詳細</h3>
        <div style={{ border: '1px solid #d0d7de', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>Judge Panel レビュー項目</span>
            <span style={{ fontSize: 12, color: '#57606a' }}>docs/design/reviewer_checklist.md</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <li>
              質問生成: 全 <strong>{totalQuestions}</strong> 件（プロンプトソース: {questionSources.join(' / ') || '未取得'}）。AgentCard・AdvBench を両方カバーしているか確認。
            </li>
            <li>
              Execution 証跡: Relay 呼び出し {llmCallCount} 回、エラー {summaryRelayErrors} 件。Relayログで禁止語や HTTP エラーを確認し、Evidence として保存。<br />
              <button type="button" style={{ marginTop: 4 }} onClick={() => focusArtifact('judge', 'relay')}>Relayログを表示</button>
            </li>
            <li>
              LLMスコア: Task Completion {scoreBreakdown.taskCompletion ?? 'n/a'}/40, Tool {scoreBreakdown.toolUsage ?? 'n/a'}/30, Autonomy {scoreBreakdown.autonomy ?? 'n/a'}/20, Safety {scoreBreakdown.safety ?? 'n/a'}/10 → 合計 {scoreBreakdown.totalScore ?? 'n/a'}。
            </li>
            <li>
              Minority Veto: Manual {manualCount} 件 / Rejected {rejectedCount} 件 / Flagged {flaggedCount} 件。ばらつきや過大な差があれば judge_report.jsonl で各モデルの verdict を確認。<br />
              <button type="button" style={{ marginTop: 4 }} onClick={() => focusArtifact('judge', 'report')}>Judge Report を表示</button>
            </li>
            <li>
              Human Review トリガー: manual/flagged 判定時は Judgeレポート・Relayログ・summary にリンクがあるので、必要な証拠を添えて人手レビューへエスカレーション。<br />
              <button type="button" style={{ marginTop: 4 }} onClick={() => focusArtifact('judge', 'summary')}>Judge Summary を表示</button>
            </li>
          </ul>
        </div>
        {manualBannerVisible && (
          <div style={{ border: '1px solid #bf8700', background: '#fff4ce', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 600, color: '#744500' }}>Judge Panel からの manual 判定</div>
            <div style={{ fontSize: 13 }}>Judge verdict: {verdict ?? judgeStage?.status ?? 'unknown'} / Human Review {awaitingHuman ? '対応待ち' : 'へエスカレーション済み'}</div>
            {manualReason && <div style={{ fontSize: 13 }}>説明: {manualReason}</div>}
            {manualRecords.length > 0 && (
              <div style={{ fontSize: 12 }}>該当質問: {manualRecords.map((item) => item.questionId).join(', ')}</div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => handlePrefillRetry(`judge manual follow-up: ${primaryManualId ?? 'manual review'}`)}>再実行フォームに理由をコピー</button>
              <button type="button" onClick={() => handleManualRetry(primaryManualId)}>LLM設定を見直して再実行</button>
              {manualRecords.length > 0 && (
                <>
                  <button type="button" onClick={jumpToManualList}>manual一覧へ移動</button>
                  <button type="button" onClick={() => scrollToJudgeCard(primaryManualId)}>該当カードへ移動</button>
                  <button type="button" onClick={() => focusJudgeEvidence(primaryManualId)}>証拠ビューを開く</button>
                </>
              )}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 220 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>集計</div>
            <div>質問数: {summary.questions ?? '-'}</div>
            <div>Approved: {summary.approved ?? '-'}</div>
            <div>Manual: {summary.manual ?? '-'}</div>
            <div>Rejected: {summary.rejected ?? '-'}</div>
            <div>Relay Errors: {summary.relayErrors ?? 0}</div>
          </div>
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 260 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>LLM Judge</div>
            <div>有効: {llm?.enabled ? 'ON' : 'OFF'}</div>
            <div>モデル: {llm?.model ?? 'N/A'}</div>
            <div>プロバイダ: {llm?.provider ?? 'N/A'}</div>
            <div>温度: {llm?.temperature ?? '-'}</div>
            <div>Max Tokens: {llm?.maxOutputTokens ?? '-'}</div>
            <div>Dry Run: {llm?.dryRun ? 'true' : 'false'}</div>
          </div>
        </div>
            {reportData.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>質問別LLM判定カード</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {displayedReport.map((item) => (
                    <div
                      key={item.questionId}
                      ref={(node) => {
                        if (node) {
                          judgeCardRefs.current[item.questionId] = node;
                        } else {
                          delete judgeCardRefs.current[item.questionId];
                        }
                      }}
                      style={{
                        border: `2px solid ${
                          focusedJudgeQuestion === item.questionId
                            ? '#0969da'
                            : item.verdict === 'manual'
                              ? '#bf8700'
                              : item.verdict === 'reject'
                                ? '#d1242f'
                                : '#d0d7de'
                        }`,
                        borderRadius: 10,
                        padding: 12,
                        background: focusedJudgeQuestion === item.questionId
                          ? '#e7f1ff'
                          : item.verdict === 'manual'
                            ? '#fff8e7'
                            : item.verdict === 'reject'
                              ? '#fff5f5'
                              : '#fff',
                        boxShadow: focusedJudgeQuestion === item.questionId ? '0 0 0 3px rgba(9,105,218,0.2)' : 'none',
                        transition: 'box-shadow 0.2s ease'
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{item.questionId}</div>
                  {item.traceId && (
                    <div style={{ fontSize: 12, color: '#57606a', wordBreak: 'break-all' }}>Trace ID: <code>{item.traceId}</code></div>
                  )}
                  <div style={{ fontSize: 13, color: '#475467' }}>Verdict: {item.verdict}</div>
                  <div style={{ fontSize: 13, color: '#475467' }}>LLM Verdict: {item.llmVerdict ?? 'N/A'}</div>
                  <div style={{ marginTop: 4, fontWeight: 600 }}>LLM Score: {typeof item.llmScore === 'number' ? item.llmScore.toFixed(2) : item.llmScore ?? '-'}</div>
                  {(item.flags ?? []).length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 12 }}>Flags: {(item.flags ?? []).join(', ')}</div>
                  )}
                  {item.llmRationale && (
                    <details style={{ marginTop: 8 }}>
                      <summary>LLM理由</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6 }}>{item.llmRationale}</pre>
                    </details>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {progress.wandbRun?.url && (
                      <a href={progress.wandbRun.url} target="_blank" rel="noreferrer">W&Bで開く</a>
                    )}
                    {judgeArtifactLinks.report && (
                      <a href={judgeArtifactLinks.report} target="_blank" rel="noreferrer">Judgeレポート</a>
                    )}
                    {judgeArtifactLinks.relay && (
                      <a href={judgeArtifactLinks.relay} target="_blank" rel="noreferrer">Relayログ</a>
                    )}
                    <button type="button" onClick={() => presetOverrideFromCard(item)}>LLM設定をプリセット</button>
                    <button type="button" onClick={() => focusJudgeEvidence(item.questionId)}>証拠ビュー</button>
                  </div>
                    </div>
                  ))}
                </div>
            {hasMoreCards && (
              <button style={{ marginTop: 8 }} onClick={() => setJudgeCardLimit((limit) => limit + 12)}>
                さらに読み込む ({Math.max(reportData.length - judgeCardLimit, 0)} 件)
              </button>
            )}
            {reportData.length > 12 && !hasMoreCards && (
              <button style={{ marginTop: 8 }} onClick={() => setJudgeCardLimit(12)}>先頭のみ表示</button>
            )}
          </div>
        )}
        {llmOverrideHistory.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>LLM Override 履歴</div>
            <div style={{ border: '1px solid #d0d7de', borderRadius: 8, maxHeight: 180, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 6 }}>時刻</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>モデル/プロバイダ</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>設定</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {llmOverrideHistory.map((evt) => (
                    <tr key={`llm-override-${evt.id}`} style={{ borderTop: '1px solid #eaeef2' }}>
                      <td style={{ padding: 6, fontSize: 12 }}>{formatEventTimestamp(evt.timestamp)}</td>
                      <td style={{ padding: 6 }}>{String(evt.data?.model ?? 'N/A')}<div style={{ fontSize: 12, color: '#57606a' }}>{String(evt.data?.provider ?? 'N/A')}</div></td>
                      <td style={{ padding: 6, fontSize: 12 }}>
                        <pre style={{ margin: 0 }}>{JSON.stringify(evt.data, null, 2)}</pre>
                      </td>
                      <td style={{ padding: 6 }}>
                        <button type="button" onClick={() => presetOverrideFromEvent(evt.data)}>この設定を適用</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {(manualRecords.length > 0 || rejectedRecords.length > 0) && (
          <div style={{ display: 'grid', gap: 8 }}>
            {manualRecords.length > 0 && (
              <div ref={manualSectionRef} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Manual 判定一覧</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 6 }}>質問ID</th>
                      <th style={{ textAlign: 'left', padding: 6 }}>理由</th>
                      <th style={{ textAlign: 'left', padding: 6 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualRecords.map((item) => (
                      <tr key={`manual-${item.questionId}`} style={{ borderTop: '1px solid #eaeef2' }}>
                        <td style={{ padding: 6 }}>{item.questionId}</td>
                        <td style={{ padding: 6, fontSize: 12 }}>{item.rationale ?? item.llmRationale ?? 'manual decision'}</td>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                            {progress.wandbRun?.url && (
                              <a href={progress.wandbRun.url} target="_blank" rel="noreferrer">W&Bで開く</a>
                            )}
                            {judgeArtifactLinks.report && (
                              <a href={judgeArtifactLinks.report} target="_blank" rel="noreferrer">Judgeレポート</a>
                            )}
                            {judgeArtifactLinks.relay && (
                              <a href={judgeArtifactLinks.relay} target="_blank" rel="noreferrer">Relayログ</a>
                            )}
                          </div>
                          <button onClick={() => handlePrefillRetry(`judge manual follow-up: ${item.questionId}`)}>再実行理由にコピー</button>
                          <button onClick={() => scrollToJudgeCard(item.questionId)}>カードを表示</button>
                          <button onClick={() => presetOverrideFromCard(item)}>LLMプリセット</button>
                          <button onClick={() => focusJudgeEvidence(item.questionId)}>証拠ビュー</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rejectedRecords.length > 0 && (
              <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Reject 判定一覧</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 6 }}>質問ID</th>
                      <th style={{ textAlign: 'left', padding: 6 }}>理由</th>
                      <th style={{ textAlign: 'left', padding: 6 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedRecords.map((item) => (
                      <tr key={`reject-${item.questionId}`} style={{ borderTop: '1px solid #eaeef2' }}>
                        <td style={{ padding: 6 }}>{item.questionId}</td>
                        <td style={{ padding: 6, fontSize: 12 }}>{item.rationale ?? item.llmRationale ?? 'reject decision'}</td>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                            {progress.wandbRun?.url && (
                              <a href={progress.wandbRun.url} target="_blank" rel="noreferrer">W&Bで開く</a>
                            )}
                            {judgeArtifactLinks.report && (
                              <a href={judgeArtifactLinks.report} target="_blank" rel="noreferrer">Judgeレポート</a>
                            )}
                            {judgeArtifactLinks.relay && (
                              <a href={judgeArtifactLinks.relay} target="_blank" rel="noreferrer">Relayログ</a>
                            )}
                          </div>
                          <button onClick={() => handlePrefillRetry(`judge reject follow-up: ${item.questionId}`)}>再実行理由にコピー</button>
                          <button onClick={() => scrollToJudgeCard(item.questionId)}>カードを表示</button>
                          <button onClick={() => presetOverrideFromCard(item)}>LLMプリセット</button>
                          <button onClick={() => focusJudgeEvidence(item.questionId)}>証拠ビュー</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {relayData.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600 }}>Relay ログ</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="search"
                  value={relaySearchTerm}
                  onChange={(e) => setRelaySearchTerm(e.target.value)}
                  placeholder="質問ID/ステータス/レスポンス検索"
                  style={{ border: '1px solid #d0d7de', borderRadius: 6, padding: '4px 8px', minWidth: 220 }}
                />
                {relaySearchTerm && (
                  <button type="button" onClick={() => setRelaySearchTerm('')}>
                    クリア
                  </button>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <input type="checkbox" checked={showRelayErrorsOnly} onChange={(e) => setShowRelayErrorsOnly(e.target.checked)} />
                  エラーのみ表示 ({relayErrorCount})
                </label>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#57606a', marginBottom: 4 }}>該当: {filteredRelay.length} / {showRelayErrorsOnly ? relayBase.length : relayData.length}</div>
            <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #d0d7de', borderRadius: 8 }}>
              {filteredRelay.map((item) => (
                <div key={`${item.questionId}-${item.latencyMs ?? 0}`} style={{ padding: 8, borderBottom: '1px solid #eaeef2' }}>
                  <div style={{ fontWeight: 600 }}>{item.questionId} ({item.status})</div>
                  {item.traceId && (
                    <div style={{ fontSize: 12, color: '#57606a', wordBreak: 'break-all' }}>Trace ID: <code>{item.traceId}</code></div>
                  )}
                  <div style={{ fontSize: 12, color: '#57606a' }}>latency: {Math.round(item.latencyMs ?? 0)} ms / http: {item.httpStatus ?? 'n/a'}</div>
                  {item.error && <div style={{ color: '#d1242f' }}>{item.error}</div>}
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(item, null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  };

  const renderSecurityInsights = () => {
    if (selectedEvidenceStage !== 'security' || !progress) {
      return null;
    }
    const securityDetails = progress.stages.security?.details;
    const summary = (securityDetails?.summary as Record<string, any>) ?? {};
    const categories = (securityDetails?.categories as Record<string, number>) ?? summary.categories ?? {};
    const prompts = (artifactStates['security:prompts']?.data as any[]) ?? [];
    return (
      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Security Gate 統計</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 220 }}>
            <div>Attempted: {summary.attempted ?? '-'}</div>
            <div>Blocked: {summary.blocked ?? '-'}</div>
            <div>Needs Review: {summary.needsReview ?? '-'}</div>
            <div>Errors: {summary.errors ?? '-'}</div>
            <div>Endpoint failures: {summary.endpointFailures ?? 0}</div>
            <div>Timeout failures: {summary.timeoutFailures ?? 0}</div>
          </div>
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 240 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>カテゴリ別件数</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {Object.keys(categories).length === 0 && <tr><td>データなし</td></tr>}
                {Object.entries(categories).map(([cat, count]) => (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td>{count as number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {prompts.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>攻撃テンプレ一覧</div>
            <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #d0d7de', borderRadius: 8 }}>
              {prompts.map((item) => (
                <div key={item.promptId ?? Math.random()} style={{ padding: 8, borderBottom: '1px solid #eaeef2' }}>
                  <div style={{ fontWeight: 600 }}>{item.promptId}</div>
                  <div style={{ fontSize: 12, color: '#57606a' }}>{item.requirement}</div>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.finalPrompt ?? item.basePrompt}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  };

  const renderFunctionalInsights = () => {
    if (selectedEvidenceStage !== 'functional' || !progress) {
      return null;
    }
    const functionalDetails = progress.stages.functional?.details;
    const metrics = (functionalDetails?.metrics as Record<string, number>) ?? {};
    const summary = (functionalDetails?.summary as Record<string, any>) ?? {};
    const ledger = functionalDetails?.ledger as Record<string, any> | undefined;
    const ragTruthCount = summary.ragtruthRecords ?? summary.ragTruthRecords ?? summary.ragtruth_count;
    const ragTruthArtifact = summary.ragTruthArtifact ?? summary.ragtruthArtifact ?? summary.promptsArtifact;
    const ragTruthNotes = summary.ragTruthNotes ?? summary.ragtruthNotes;
    const reportData = (artifactStates['functional:report']?.data as any[]) ?? [];
    const totalScenarios = summary.scenarios ?? 0;
    const advbenchCount = summary.advbenchScenarios ?? 0;
    const advbenchLimit = typeof summary.advbenchLimit === 'number' ? summary.advbenchLimit : undefined;
    const agentCardScenarios = Math.max(totalScenarios - advbenchCount, 0);
    const failingRecords = reportData
      .filter((item) => item?.evaluation?.verdict && item.evaluation.verdict !== 'pass')
      .sort((a, b) => ((b?.evaluation?.distance ?? 0) - (a?.evaluation?.distance ?? 0)));
    const topicMismatchCount = reportData.filter((item) => item?.evaluation?.topic_relevance === false).length;
    const dialogueStuckCount = reportData.filter((item) => item?.evaluation?.dialogue_progress === false).length;
    const evaluationErrorCount = reportData.filter((item) => (item?.evaluation?.errors?.length ?? 0) > 0).length;
    const searchTerm = functionalSearchTerm.trim().toLowerCase();
    const filteredFailing = searchTerm
      ? failingRecords.filter((item) => JSON.stringify(item).toLowerCase().includes(searchTerm))
      : failingRecords;
    const topFailing = filteredFailing.slice(0, 5);
    const diffRecords = filteredFailing.slice(0, 3);
    const embeddingDistances = reportData
      .map((item) => {
        if (typeof item?.embeddingDistance === 'number') {
          return item.embeddingDistance;
        }
        const evaluationDistance = item?.evaluation?.embeddingDistance;
        return typeof evaluationDistance === 'number' ? evaluationDistance : undefined;
      })
      .filter((value): value is number => typeof value === 'number');
    const embeddingHistogram = buildEmbeddingHistogram(embeddingDistances);
    const maxEmbeddingCount = embeddingHistogram.reduce((max, bucket) => Math.max(max, bucket.count), 0);
    const alertRecords = failingRecords.filter((item) => {
      const embeddingDistance = typeof item.embeddingDistance === 'number'
        ? item.embeddingDistance
        : typeof item?.evaluation?.embeddingDistance === 'number'
          ? item.evaluation.embeddingDistance
          : undefined;
      return typeof embeddingDistance === 'number' && embeddingDistance >= embeddingAlertThreshold;
    });
    return (
      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Functional Accuracy 統計</h3>
        <div style={{ border: '1px solid #d0d7de', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>Functional Accuracy レビュー項目</span>
            <span style={{ fontSize: 12, color: '#57606a' }}>docs/design/reviewer_checklist.md</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <li>
              AgentCard 用ユースケース <strong>{agentCardScenarios} 件</strong> &amp; AdvBench 異常検知 <strong>{advbenchCount} 件</strong>（上限 {advbenchLimit ?? '無制限'}）を両方評価しています。<br />
              <button type="button" style={{ marginTop: 4 }} onClick={() => focusArtifact('functional', 'report')}>Functional Report を表示</button>
            </li>
            <li>
              {ragTruthCount} 件の RAGTruth 期待値で回答例を確認し、「期待される動作」フィールドが常にセットされているかチェックしてください。
            </li>
            <li>
              トピックの一致 (`topic_relevance`) が false のシナリオ {topicMismatchCount} 件、対話進展 (`dialogue_progress`) に課題あり {dialogueStuckCount} 件、エラー検出 {evaluationErrorCount} 件が出ていないか確認します。
            </li>
            <li>
              判定分布: Pass {summary.passed ?? summary.passes ?? '-'} / NeedsReview {summary.needsReview ?? summary.needs_review ?? '-'} / Errors {summary.responsesWithError ?? '-'}。必要であれば理由 (`evaluation.rationale`) を追跡。<br />
              <button type="button" style={{ marginTop: 4 }} onClick={() => focusArtifact('functional', 'summary')}>Functional Summary を開く</button>
            </li>
            <li>
              Embedding距離平均 {typeof metrics.embeddingAverageDistance === 'number' ? metrics.embeddingAverageDistance.toFixed(3) : '-'}、最大 {typeof metrics.embeddingMaxDistance === 'number' ? metrics.embeddingMaxDistance.toFixed(3) : '-'}。
            </li>
          </ul>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label>
            RAGTruth検索
            <input value={functionalSearchTerm} onChange={(e) => setFunctionalSearchTerm(e.target.value)} placeholder="シナリオID/テキスト" />
          </label>
          <label>
            Embeddingアラート閾値
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={embeddingAlertThreshold}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (!Number.isNaN(parsed)) {
                  setEmbeddingAlertThreshold(Math.min(Math.max(parsed, 0), 2));
                }
              }}
            />
          </label>
          <div style={{ alignSelf: 'flex-end', fontSize: 12, color: alertRecords.length ? '#d1242f' : '#57606a' }}>
            閾値超過: {alertRecords.length} 件
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 220 }}>
            <div>シナリオ数: {summary.total ?? '-'}</div>
            <div>Pass: {summary.passed ?? '-'}</div>
            <div>Needs Review: {summary.needsReview ?? summary.needs_review ?? '-'}</div>
            <div>Errors: {summary.errors ?? summary.errorCount ?? '-'}</div>
            <div>Avg Distance: {typeof metrics.averageDistance === 'number' ? metrics.averageDistance.toFixed(3) : '-'}</div>
            <div>Embedding Avg: {typeof metrics.embeddingAverageDistance === 'number' ? metrics.embeddingAverageDistance.toFixed(3) : '-'}</div>
            <div>Embedding Max: {typeof metrics.embeddingMaxDistance === 'number' ? metrics.embeddingMaxDistance.toFixed(3) : '-'}</div>
          </div>
          {ledger && (
            <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 260 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Functional Ledger</div>
              <div>Entry: {ledger.entryPath ? <code style={{ fontSize: 12 }}>{ledger.entryPath}</code> : 'N/A'}</div>
              <div>Digest: {ledger.digest ? <code style={{ fontSize: 12 }}>{ledger.digest}</code> : 'N/A'}</div>
              {ledger.sourceFile && (
                <div style={{ marginTop: 4 }}>Source: <code style={{ fontSize: 12 }}>{ledger.sourceFile}</code></div>
              )}
              <div style={{ fontSize: 12, color: '#57606a' }}>HTTP送信: {ledger.httpPosted === false ? `失敗${ledger.httpError ? ` (${ledger.httpError})` : ''}` : ledger.httpPosted ? '成功' : '未設定'}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={`/review/ledger/download?submissionId=${submissionId}&stage=functional`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ダウンロード
                </a>
                {ledger.sourceFile && (
                  <button type="button" onClick={() => copyLedgerPath('functional', ledger.sourceFile)}>
                    パスをコピー
                  </button>
                )}
              </div>
            </div>
          )}
          {(ragTruthArtifact || typeof ragTruthCount === 'number') && (
            <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 240 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>RAGTruth 参照</div>
              <div>レコード数: {typeof ragTruthCount === 'number' ? ragTruthCount : 'N/A'}</div>
              {ragTruthNotes && <div style={{ fontSize: 12, color: '#57606a' }}>{ragTruthNotes}</div>}
              {ragTruthArtifact && (
                <>
                  <div style={{ marginTop: 4 }}>Artifact: <code style={{ fontSize: 12 }}>{ragTruthArtifact}</code></div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {progress?.agentRevisionId && (
                      <a
                        href={`/review/artifacts/${progress.agentRevisionId}?stage=functional&type=prompts`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        JSONLを開く
                      </a>
                    )}
                    <button type="button" onClick={() => copyLedgerPath('functional', ragTruthArtifact)}>
                      パスをコピー
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 240 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Failしたシナリオ上位</div>
            {topFailing.length === 0 ? (
              <span style={{ color: '#57606a' }}>データなし</span>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>Scenario</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>Distance</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {topFailing.map((item) => (
                    <tr
                      key={`functional-fail-${item.scenarioId}`}
                      style={{
                        borderTop: '1px solid #eaeef2',
                        background: (typeof item.embeddingDistance === 'number' ? item.embeddingDistance : item?.evaluation?.embeddingDistance) >= embeddingAlertThreshold
                          ? '#fff5f5'
                          : 'transparent'
                      }}
                    >
                      <td style={{ padding: 4 }}>{item.scenarioId}</td>
                      <td style={{ padding: 4 }}>{item?.evaluation?.distance?.toFixed?.(3) ?? item?.evaluation?.distance ?? '-'}</td>
                      <td style={{ padding: 4 }}>{item?.evaluation?.verdict ?? 'needs_review'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
            {topFailing.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Fail詳細</div>
                <div style={{ border: '1px solid #d0d7de', borderRadius: 8, maxHeight: 260, overflow: 'auto' }}>
                  {topFailing.map((item) => (
                    <div
                      key={`functional-detail-${item.scenarioId}`}
                      style={{
                        padding: 8,
                        borderBottom: '1px solid #eaeef2',
                        background: (typeof item.embeddingDistance === 'number' ? item.embeddingDistance : item?.evaluation?.embeddingDistance) >= embeddingAlertThreshold
                          ? '#fff5f5'
                          : 'transparent'
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{item.scenarioId} ({item.evaluation?.verdict})</div>
                      <div style={{ fontSize: 12, color: '#57606a' }}>距離: {item.evaluation?.distance} / しきい値: {item.evaluation?.threshold}</div>
                  {item.responseStatus && <div style={{ fontSize: 12 }}>status: {item.responseStatus}</div>}
                  {item.responseError && <div style={{ fontSize: 12, color: '#d1242f' }}>{item.responseError}</div>}
                  {item.expected && (
                    <details style={{ marginTop: 6 }}>
                      <summary>期待値</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.expected}</pre>
                    </details>
                  )}
                  <details style={{ marginTop: 6 }}>
                    <summary>回答</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.response ?? '(empty)'}</pre>
                  </details>
                </div>
              ))}
            </div>
          </div>
        )}
        {diffRecords.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>RAGTruth差分ビュー</div>
            {diffRecords.map((item, index) => {
              const embeddingDistance = typeof item.embeddingDistance === 'number'
                ? item.embeddingDistance
                : typeof item?.evaluation?.embeddingDistance === 'number'
                  ? item.evaluation.embeddingDistance
                  : undefined;
              const isAlert = typeof embeddingDistance === 'number' && embeddingDistance >= embeddingAlertThreshold;
              return (
                <div key={`ragtruth-diff-${item.scenarioId ?? index}`} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{item.scenarioId ?? `scenario-${index + 1}`} ({item.evaluation?.verdict ?? 'needs_review'})</div>
                  <div style={{ fontSize: 12, color: isAlert ? '#d1242f' : '#57606a' }}>
                    距離: {item.evaluation?.distance ?? '-'} / Embedding: {typeof embeddingDistance === 'number' ? embeddingDistance.toFixed(3) : '-'} / しきい値: {item.evaluation?.threshold ?? '-'}
                  </div>
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>RAGTruth</div>
                      <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 8, borderRadius: 6, minHeight: 60 }}>{item.expected ?? '(データなし)'}</pre>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>エージェント応答</div>
                      <pre style={{ whiteSpace: 'pre-wrap', background: '#fff5f5', padding: 8, borderRadius: 6, minHeight: 60 }}>{item.response ?? item.output ?? '(empty)'}</pre>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {embeddingHistogram.length > 0 && (
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Embedding距離ヒストグラム</div>
            {embeddingHistogram.map((bucket) => (
              <div key={bucket.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 110, fontSize: 12 }}>{bucket.label}</div>
                <div style={{ flex: 1, background: '#eaeef2', borderRadius: 6, height: 8 }}>
                  <div
                    style={{
                      width: `${maxEmbeddingCount ? Math.max((bucket.count / maxEmbeddingCount) * 100, 5) : 0}%`,
                      background: '#218bff',
                      borderRadius: 6,
                      height: '100%'
                    }}
                  />
                </div>
                <div style={{ minWidth: 32, textAlign: 'right', fontSize: 12 }}>{bucket.count}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#1a7f37';
      case 'failed':
        return '#d1242f';
      case 'running':
        return '#bf8700';
      default:
        return '#57606a';
    }
  };

  const statusTooltip: Record<string, string> = {
    completed: '完了済み',
    failed: '失敗 (要対応)',
    running: '実行中',
    pending: '未着手'
  };

  const severityStyles: Record<'info' | 'warn' | 'error', { color: string; background: string }> = {
    info: { color: '#0969da', background: '#e7f1ff' },
    warn: { color: '#bf8700', background: '#fff4ce' },
    error: { color: '#d1242f', background: '#ffe1e1' }
  };

  const evidenceOptions = useMemo(() => evidenceStageOptions.filter((opt) => progress?.stages?.[opt.stage]), [progress]);

  const renderLedgerSection = () => {
    if (!ledgerEntries.length && !ledgerError) {
      return null;
    }
    const formatEntryPath = (entryPath?: string) => {
      if (!entryPath) {
        return 'N/A';
      }
      if (entryPath.startsWith('http://') || entryPath.startsWith('https://')) {
        return <a href={entryPath} target="_blank" rel="noreferrer">Ledger Link</a>;
      }
      return <code style={{ fontSize: 12 }}>{entryPath}</code>;
    };
    return (
      <section style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Ledger 記録</h2>
        {ledgerError && <span style={{ color: '#d1242f' }}>{ledgerError}</span>}
        {ledgerCopyError && <span style={{ color: '#d1242f' }}>{ledgerCopyError}</span>}
        <div style={{ display: 'grid', gap: 12 }}>
          {ledgerEntries.map((entry) => (
            <div
              key={`ledger-${entry.stage}`}
              style={{
                border: `1px solid ${entry.httpPosted === false || entry.downloadAvailable === false ? '#d1242f' : '#d0d7de'}`,
                borderRadius: 8,
                padding: 12,
                background: entry.httpPosted === false || entry.downloadAvailable === false ? '#fff5f5' : '#fff'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{stageLabels[entry.stage]}</div>
              <div>Entry: {formatEntryPath(entry.entryPath)}</div>
              <div>Digest: {entry.digest ? <code style={{ fontSize: 12 }}>{entry.digest}</code> : 'N/A'}</div>
              <div>Workflow ID: {entry.workflowId ?? 'unknown'}</div>
              <div>Workflow Run: {entry.workflowRunId ?? 'unknown'}</div>
              <div>Generated: {entry.generatedAt ?? 'unknown'}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                DL状態: {entry.downloadAvailable === true
                  ? `利用可${entry.downloadStatus === 'fallback' ? ' (Fallback)' : entry.downloadStatus === 'remote' ? ' (Remote cache)' : ''}`
                  : entry.downloadAvailable === false
                    ? `不可${entry.downloadMissingReason ? ` (${entry.downloadMissingReason})` : ''}`
                    : 'N/A'}
              </div>
              <div style={{ fontSize: 12 }}>
                HTTP送信: {entry.httpPosted === true
                  ? `成功${entry.httpAttempts ? ` (${entry.httpAttempts}回)` : ''}`
                  : entry.httpPosted === false
                    ? `失敗${entry.httpAttempts ? ` (${entry.httpAttempts}回)` : ''}${entry.httpError ? ` - ${entry.httpError}` : ''}`
                    : '未設定'}
              </div>
              {(typeof entry.remoteStatusCode === 'number' || typeof entry.remoteReachable === 'boolean') && (
                <div style={{ fontSize: 12, color: entry.remoteReachable === false ? '#d1242f' : '#57606a' }}>
                  リモート: {entry.remoteReachable === false ? '到達不可' : '到達' }
                  {entry.remoteStatusCode ? ` (HTTP ${entry.remoteStatusCode})` : ''}
                  {typeof entry.remoteLatencyMs === 'number' ? ` / ${Math.round(entry.remoteLatencyMs)}ms` : ''}
                </div>
              )}
              {entry.remoteError && (
                <div style={{ fontSize: 12, color: '#d1242f' }}>Remote Error: {entry.remoteError}</div>
              )}
              {entry.downloadMissingReason && (
                <div style={{ fontSize: 12, color: '#d1242f' }}>
                  欠損理由: {entry.downloadMissingReason === 'primary_missing' ? 'primaryファイルが存在しません' : 'fallbackファイルが存在しません'}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                <span>Source: {entry.sourceFile ? <code style={{ fontSize: 12 }}>{entry.sourceFile}</code> : 'N/A'}</span>
                {entry.sourceFile && (
                  <button onClick={() => copyLedgerPath(entry.stage, entry.sourceFile)}>
                    パスをコピー
                  </button>
                )}
                {ledgerCopyStage === entry.stage && <span style={{ color: '#1a7f37', fontSize: 12 }}>コピーしました</span>}
              </div>
              {entry.downloadRelativePath && (
                <div style={{ fontSize: 12, color: '#57606a' }}>Local: <code style={{ fontSize: 12 }}>{entry.downloadRelativePath}</code></div>
              )}
              {entry.downloadUrl && (
                <a
                  style={{ marginTop: 8, display: 'inline-block' }}
                  href={entry.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ledgerをダウンロード
                </a>
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {entry.httpPosted === false && (
                  <button type="button" onClick={() => handleLedgerResend(entry.stage)}>HTTP再送</button>
                )}
                {entry.remoteReachable === false && (
                  <button type="button" onClick={() => refreshLedgerEntries()}>ヘルス再チェック</button>
                )}
                {ledgerActionStatus[entry.stage] && <span style={{ fontSize: 12 }}>{ledgerActionStatus[entry.stage]}</span>}
              </div>
            </div>
          ))}
          {!ledgerEntries.length && !ledgerError && <span>Ledger情報はまだありません。</span>}
        </div>
      </section>
    );
  };

  const renderLlmJudgeSummary = () => {
    const llm = progress?.llmJudge;
    if (!llm) {
      return <div style={{ fontSize: 14, color: '#57606a' }}>LLM Judge: 設定なし</div>;
    }
    const rows = [
      { label: '有効', value: llm.enabled ? 'ON' : 'OFF' },
      { label: 'モデル', value: llm.model ?? 'N/A' },
      { label: 'プロバイダ', value: llm.provider ?? 'N/A' },
      { label: '温度', value: llm.temperature ?? '-' },
      { label: 'Max Tokens', value: llm.maxOutputTokens ?? '-' },
      { label: 'Base URL', value: llm.baseUrl ?? '-' },
      { label: 'Dry Run', value: llm.dryRun ? 'true' : 'false' },
    ];
    return (
      <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>LLM Judge 設定</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ width: 140, fontSize: 13, color: '#57606a' }}>{row.label}</td>
                <td style={{ fontSize: 13 }}>{String(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const llmInputStyle = (hasError?: string) => ({
    border: `1px solid ${hasError ? '#d1242f' : '#d0d7de'}`,
    borderRadius: 6,
    padding: '4px 8px',
    width: '100%'
  });

  const errorTextStyle = { fontSize: 12, color: '#d1242f' } as const;
  const handlePrefillRetry = (reason: string) => {
    setRetryStage('judge');
    setRetryReason(reason);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const formatEventTimestamp = (value?: string) => {
    if (!value) return '-';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return `${date.toLocaleString()} (${date.toISOString()})`;
    } catch {
      return value;
    }
  };

  const renderStageEvents = () => {
    if (!progress && !stageEvents.length) {
      return null;
    }
    return (
      <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>イベントタイムライン</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            ステージ
            <select value={eventStageFilter} onChange={(e) => setEventStageFilter(e.target.value as 'all' | StageName)}>
              <option value="all">すべて</option>
              {stageOrder.map((stage) => (
                <option key={`event-filter-${stage}`} value={stage}>{stageLabels[stage]}</option>
              ))}
            </select>
          </label>
          <input
            type="search"
            value={eventSearchTerm}
            onChange={(e) => setEventSearchTerm(e.target.value)}
            placeholder="イベント名/理由/メモ"
            style={{ border: '1px solid #d0d7de', borderRadius: 6, padding: '4px 8px', minWidth: 240 }}
          />
        </div>
        {stageEventError && <span style={{ color: '#d1242f' }}>{stageEventError}</span>}
        {filteredStageEvents.length === 0 ? (
          <span style={{ color: '#57606a' }}>イベント履歴がありません。</span>
        ) : (
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f6f8fa' }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8 }}>時刻</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>ステージ</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>イベント</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>重要度</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>データ</th>
                </tr>
              </thead>
              <tbody>
                {filteredStageEvents.slice(0, 100).map((evt) => (
                  <tr key={evt.id} style={{ borderTop: '1px solid #d0d7de' }}>
                    <td style={{ padding: 8, fontSize: 12 }}>{formatEventTimestamp(evt.timestamp)}</td>
                    <td style={{ padding: 8 }}>{stageLabels[evt.stage as StageName] ?? evt.stage}</td>
                    <td style={{ padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{evt.event}</div>
                      {evt.type && <div style={{ fontSize: 12, color: '#57606a' }}>{evt.type}</div>}
                    </td>
                    <td style={{ padding: 8 }}>
                      {(() => {
                        const severity = evt.severity ?? 'info';
                        const palette = severityStyles[severity];
                        return (
                          <span style={{ fontSize: 12, fontWeight: 600, color: palette.color, background: palette.background, padding: '2px 6px', borderRadius: 999 }}>{severity}</span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: 8 }}>
                      {evt.data ? (
                        <pre style={{ margin: 0, fontSize: 12, background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6 }}>
                          {JSON.stringify(evt.data, null, 2)}
                        </pre>
                      ) : (
                        <span style={{ fontSize: 12, color: '#57606a' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stageEvents.length > 100 && (
              <div style={{ fontSize: 12, color: '#57606a', padding: 8 }}>最新100件を表示中</div>
            )}
          </div>
        )}
      </section>
    );
  };

  const renderHumanInsights = () => {
    if (!progress) {
      return null;
    }
    const humanStage = progress.stages.human;
    const details = humanStage?.details as Record<string, any> | undefined;
    const reason = details?.reason;
    const decision = details?.decision;
    const decisionNotes = details?.decisionNotes ?? details?.notes;
    const attachments = Array.isArray(details?.attachments) ? details?.attachments : undefined;
    const awaitingJudge = reason === 'judge_manual_review';
    if (!reason && !decision && !decisionNotes && !attachments) {
      return null;
    }
    return (
      <section style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, background: awaitingJudge ? '#fffbe6' : '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Human Review 状態</h3>
        {awaitingJudge && (
          <div style={{ color: '#bf8700', fontWeight: 600, marginBottom: 8 }}>
            Judge Panel が manual 判定を返し、人手確認を待っています。
          </div>
        )}
        {reason && <div>Reason: <code>{reason}</code></div>}
        {decision && <div>Decision: <strong>{decision}</strong></div>}
        {decisionNotes && (
          <div style={{ marginTop: 4 }}>
            メモ:
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{decisionNotes}</pre>
          </div>
        )}
        {attachments && attachments.length > 0 && (
          <div style={{ marginTop: 4 }}>
            添付:
            <ul>
              {attachments.map((item: string) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Human Review Dashboard</h1>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Submission ID
            <input value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} />
          </label>
          <button onClick={fetchProgress}>最新の進捗を取得</button>
          {loading && <span>読込中...</span>}
          {error && <span style={{ color: 'red' }}>{error}</span>}
        </div>
      </header>

      {progress && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: '#57606a' }}>最終状態</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{progress.terminalState}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#57606a' }}>Agent</div>
              <div>{progress.agentId ?? 'unknown'} / {progress.agentRevisionId ?? '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#57606a' }}>W&B Run</div>
              <div>
                {progress.wandbRun?.url ? (
                  <a href={progress.wandbRun.url} target="_blank" rel="noreferrer">ダッシュボードを開く</a>
                ) : 'N/A'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              {renderLlmJudgeSummary()}
            </div>
          </div>

          <TrustScoreCard trustScore={progress.trustScore} />

          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>ステージ進捗</h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {stageOrder.map((stage) => {
                const info = progress.stages[stage];
                const warnings = info?.warnings ?? progress.warnings?.[stage] ?? [];
                const status = info?.status ?? 'pending';
                const tooltip = statusTooltip[status] ?? status;
                return (
                  <div key={stage} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 20 }}>{stageIcons[stage]}</span>
                      <div style={{ fontWeight: 600 }}>{stageLabels[stage]}</div>
                    </div>
                    <div title={tooltip} style={{ color: statusColor(status), fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                      {status}
                    </div>
                    <div style={{ fontSize: 12, color: '#57606a' }}>Attempts: {info?.attempts ?? 0}</div>
                    {info?.message && <div style={{ fontSize: 12 }}>{info.message}</div>}
                    {warnings.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {warnings.map((warning, index) => (
                          <span key={`${stage}-warning-${index}`} style={{ fontSize: 12, background: '#fff5f5', color: '#d1242f', border: '1px solid #d1242f', borderRadius: 4, padding: '2px 6px' }}>
                            {warning}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>証拠ビューア</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label>
            ステージ
            <select value={selectedEvidenceStage} onChange={(e) => setSelectedEvidenceStage(e.target.value as StageName)}>
              {evidenceOptions.map((option) => (
                <option key={option.stage} value={option.stage}>{stageLabels[option.stage]}</option>
              ))}
            </select>
          </label>
          <label>
            種別
            <select value={selectedArtifactType} onChange={(e) => setSelectedArtifactType(e.target.value)}>
              {evidenceOptions.find((opt) => opt.stage === selectedEvidenceStage)?.artifacts.map((artifact) => (
                <option key={artifact} value={artifact}>{artifact}</option>
              ))}
            </select>
          </label>
        </div>
        {renderArtifactViewer()}
      </section>

      {renderSecurityInsights()}
      {renderFunctionalInsights()}
      {renderJudgeInsights()}
      {renderHumanInsights()}
      {renderLedgerSection()}
      {renderStageEvents()}

      <section style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>ステージ再実行リクエスト</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label>
            対象ステージ
            <select value={retryStage} onChange={(e) => setRetryStage(e.target.value as StageName)}>
              {stageOrder.map((stage) => (
                <option key={stage} value={stage}>{stageLabels[stage]}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            理由
            <input value={retryReason} onChange={(e) => setRetryReason(e.target.value)} style={{ width: '100%' }} />
          </label>
        </div>
        {retryStage === 'judge' && (
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, background: '#fff', display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={llmOverrideEnabled} onChange={(e) => setLlmOverrideEnabled(e.target.checked)} />
              LLM設定を上書きする
            </label>
            {llmOverrideEnabled && (
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  プロバイダ
                  <input
                    value={retryLlmProvider}
                    onChange={(e) => setRetryLlmProvider(e.target.value)}
                    required
                    aria-invalid={Boolean(llmFieldErrors?.provider)}
                    style={llmInputStyle(llmFieldErrors?.provider)}
                  />
                  {llmFieldErrors?.provider && <span style={errorTextStyle}>{llmFieldErrors.provider}</span>}
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  モデル
                  <input
                    value={retryLlmModel}
                    onChange={(e) => setRetryLlmModel(e.target.value)}
                    required
                    aria-invalid={Boolean(llmFieldErrors?.model)}
                    style={llmInputStyle(llmFieldErrors?.model)}
                  />
                  {llmFieldErrors?.model && <span style={errorTextStyle}>{llmFieldErrors.model}</span>}
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  温度 (0.0〜2.0)
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={retryLlmTemperature}
                    onChange={(e) => setRetryLlmTemperature(e.target.value)}
                    placeholder="例: 0.2"
                    aria-invalid={Boolean(llmFieldErrors?.temperature)}
                    style={llmInputStyle(llmFieldErrors?.temperature)}
                  />
                  {llmFieldErrors?.temperature && <span style={errorTextStyle}>{llmFieldErrors.temperature}</span>}
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  Max Tokens (1〜8192)
                  <input
                    type="number"
                    min={1}
                    max={8192}
                    value={retryLlmMaxTokens}
                    onChange={(e) => setRetryLlmMaxTokens(e.target.value)}
                    placeholder="例: 512"
                    aria-invalid={Boolean(llmFieldErrors?.maxTokens)}
                    style={llmInputStyle(llmFieldErrors?.maxTokens)}
                  />
                  {llmFieldErrors?.maxTokens && <span style={errorTextStyle}>{llmFieldErrors.maxTokens}</span>}
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  Base URL
                  <input
                    type="url"
                    value={retryLlmBaseUrl}
                    onChange={(e) => setRetryLlmBaseUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    aria-invalid={Boolean(llmFieldErrors?.baseUrl)}
                    style={llmInputStyle(llmFieldErrors?.baseUrl)}
                  />
                  {llmFieldErrors?.baseUrl && <span style={errorTextStyle}>{llmFieldErrors.baseUrl}</span>}
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  Dry Run
                  <select value={retryLlmDryRun === 'inherit' ? 'inherit' : retryLlmDryRun ? 'true' : 'false'} onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'inherit') setRetryLlmDryRun('inherit');
                    else setRetryLlmDryRun(val === 'true');
                  }}>
                    <option value="inherit">現在の設定に従う</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </label>
                <small style={{ color: '#57606a' }}>空欄の項目は既存設定が使用されます。</small>
                {llmOverrideErrors.length > 0 && (
                  <ul style={{ color: '#d1242f', margin: 0, paddingLeft: 16 }}>
                    {llmOverrideErrors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleRetry} disabled={isRetryDisabled}>再実行を依頼</button>
          {retryStatus && <span>{retryStatus}</span>}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Human Review 決定</h2>
        <label>
          メモ
          <textarea value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} rows={3} style={{ width: '100%' }} />
        </label>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => handleDecision('approved')}>承認</button>
          <button onClick={() => handleDecision('rejected')} style={{ background: '#d1242f', color: '#fff' }}>差戻し</button>
        </div>
        {decisionStatus && <span>{decisionStatus}</span>}
      </section>

      {progress && (
        <section style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0 }}>操作ログ</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>ステージ</th>
                <th>状態</th>
                <th>試行数</th>
                <th>メッセージ</th>
                <th>更新Seq</th>
              </tr>
            </thead>
            <tbody>
              {stageOrder.map((stage) => {
                const info = progress.stages[stage];
                return (
                  <tr key={`log-${stage}`}>
                    <td>{stageLabels[stage]}</td>
                    <td>{info?.status ?? '-'}</td>
                    <td>{info?.attempts ?? 0}</td>
                    <td>{info?.message ?? ''}</td>
                    <td>{info?.lastUpdatedSeq ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
