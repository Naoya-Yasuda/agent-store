'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type StageName = 'precheck' | 'security' | 'functional' | 'judge' | 'human' | 'publish';

type ArtifactDescriptor = {
  stage: StageName | string;
  type: string;
  agentRevisionId: string;
  agentId?: string;
};

type StageDetails = {
  summary?: unknown;
  metrics?: Record<string, unknown>;
  artifacts?: Record<string, ArtifactDescriptor>;
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

type ProgressResponse = {
  terminalState: string;
  stages: Record<StageName, StageInfo>;
  wandbRun?: WandbInfo;
  agentId?: string;
  agentRevisionId?: string;
};

type ArtifactState = {
  loading: boolean;
  error?: string;
  data?: unknown;
  raw?: string;
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

const evidenceStageOptions: { stage: StageName; artifacts: string[] }[] = [
  { stage: 'security', artifacts: ['summary', 'report', 'metadata'] },
  { stage: 'functional', artifacts: ['summary', 'report'] },
  { stage: 'judge', artifacts: ['summary', 'report', 'relay'] }
];

export default function ReviewDashboard() {
  const [submissionId, setSubmissionId] = useState('demo');
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryStage, setRetryStage] = useState<StageName>('security');
  const [retryReason, setRetryReason] = useState('');
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const [selectedEvidenceStage, setSelectedEvidenceStage] = useState<StageName>('security');
  const [selectedArtifactType, setSelectedArtifactType] = useState('summary');
  const [artifactStates, setArtifactStates] = useState<Record<string, ArtifactState>>({});

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  useEffect(() => {
    const option = evidenceStageOptions.find((opt) => opt.stage === selectedEvidenceStage);
    if (option && !option.artifacts.includes(selectedArtifactType)) {
      setSelectedArtifactType(option.artifacts[0]);
    }
  }, [selectedEvidenceStage, selectedArtifactType]);

  const buildArtifactUrl = (descriptor: ArtifactDescriptor) => {
    const params = new URLSearchParams({ stage: descriptor.stage, type: descriptor.type });
    if (descriptor.agentId) {
      params.set('agentId', descriptor.agentId);
    }
    return `/review/artifacts/${descriptor.agentRevisionId}?${params.toString()}`;
  };

  const loadArtifact = async (descriptor: ArtifactDescriptor | undefined, cacheKey: string) => {
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
  };

  const handleRetry = async () => {
    if (!retryReason.trim()) {
      setRetryStatus('理由を入力してください');
      return;
    }
    setRetryStatus('送信中...');
    try {
      const res = await fetch('/review/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, stage: retryStage, reason: retryReason })
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
      <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 16 }}>
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
      </div>
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

  const evidenceOptions = useMemo(() => evidenceStageOptions.filter((opt) => progress?.stages?.[opt.stage]), [progress]);

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
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>ステージ進捗</h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {stageOrder.map((stage) => {
                const info = progress.stages[stage];
                return (
                  <div key={stage} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, minWidth: 140 }}>
                    <div style={{ fontWeight: 600 }}>{stageLabels[stage]}</div>
                    <div style={{ color: statusColor(info?.status ?? 'pending') }}>{info?.status ?? 'pending'}</div>
                    <div style={{ fontSize: 12, color: '#57606a' }}>Attempts: {info?.attempts ?? 0}</div>
                    {info?.message && <div style={{ fontSize: 12 }}>{info.message}</div>}
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
          <button onClick={handleRetry}>再実行を依頼</button>
        </div>
        {retryStatus && <span>{retryStatus}</span>}
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
