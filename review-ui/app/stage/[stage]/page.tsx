'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { stageGuidance, stageIcons, stageLabels, stageOrder, StageName } from '../../../src/lib/stageData';

type ArtifactDescriptor = {
  stage: StageName | string;
  type: string;
  agentRevisionId: string;
  agentId?: string;
};

type StageDetails = {
  summary?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  artifacts?: Record<string, ArtifactDescriptor>;
  reason?: string;
  ledger?: {
    entryPath?: string;
    digest?: string;
    sourceFile?: string;
    httpPosted?: boolean;
    httpAttempts?: number;
    httpError?: string;
  };
};

type StageInfo = {
  status?: string;
  warnings?: string[];
  message?: string;
  attempts?: number;
  details?: StageDetails;
};

type TrustScoreBreakdown = {
  security: number;
  functional: number;
  judge: number;
  implementation: number;
  total: number;
  autoDecision: 'auto_approved' | 'auto_rejected' | 'requires_human_review';
  reasoning: Record<string, string | undefined>;
};

type ProgressResponse = {
  terminalState?: string;
  stages: Record<StageName, StageInfo>;
  wandbRun?: { url?: string };
  agentId?: string;
  agentRevisionId?: string;
  trustScore?: TrustScoreBreakdown;
  warnings?: Record<StageName, string[]>;
};

const statusLabel: Record<string, string> = {
  completed: '完了済み',
  failed: '失敗 (要対応)',
  running: '実行中',
  pending: '未着手'
};

const buildArtifactUrl = (descriptor: ArtifactDescriptor) => {
  const params = new URLSearchParams({
    stage: descriptor.stage,
    type: descriptor.type
  });
  if (descriptor.agentId) {
    params.set('agentId', descriptor.agentId);
  }
  return `/review/artifacts/${descriptor.agentRevisionId}?${params.toString()}`;
};

export default function StageDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const stageParam = params.stage as StageName | undefined;
  const stage: StageName = stageParam && stageOrder.includes(stageParam) ? stageParam : 'precheck';
  const submissionId = searchParams.get('submissionId') ?? 'demo';
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    fetch(`/review/progress/${submissionId}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(res.statusText || 'progress fetch failed');
        }
        return res.json() as Promise<ProgressResponse>;
      })
      .then((data) => {
        if (!cancel) {
          setProgress(data);
        }
      })
      .catch((err) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'fetch_error');
        }
      })
      .finally(() => {
        if (!cancel) {
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [submissionId, stage]);

  const stageInfo = progress?.stages?.[stage];
  const summary = stageInfo?.details?.summary;
  const guidance = stageGuidance[stage];
  const artifacts = stageInfo?.details?.artifacts;
  const artifactEntries = artifacts ? Object.entries(artifacts) : [];
  const buildArtifactLink = (type: string) => {
    const descriptor = artifacts?.[type];
    return descriptor ? buildArtifactUrl(descriptor) : null;
  };
  const reportLink = buildArtifactLink('report');
  const summaryLink = buildArtifactLink('summary');

  const warnings = stageInfo?.warnings ?? progress?.warnings?.[stage] ?? [];
  const ledger = stageInfo?.details?.ledger;

  const stageStatusLabel = stageInfo?.status ? (statusLabel[stageInfo.status] ?? stageInfo.status) : '未取得';

  const stageMetrics = stageInfo?.details?.metrics ?? {};
  const reportArtifact = artifacts?.report;
  const [functionalRecords, setFunctionalRecords] = useState<any[]>([]);
  const [functionalLoading, setFunctionalLoading] = useState(false);
  const [functionalError, setFunctionalError] = useState<string | null>(null);
  const [functionalVerdictFilter, setFunctionalVerdictFilter] = useState<'all' | 'pass' | 'needs_review' | 'fail'>('all');

  useEffect(() => {
    if (stage !== 'functional' || !reportArtifact) {
      setFunctionalRecords([]);
      setFunctionalError(null);
      return;
    }
    let cancelled = false;
    setFunctionalLoading(true);
    setFunctionalError(null);
    fetch(buildArtifactUrl(reportArtifact))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.statusText || 'artifact fetch failed');
        }
        const text = await res.text();
        const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
        const parsed = lines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        if (!cancelled) {
          setFunctionalRecords(parsed);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFunctionalError(err instanceof Error ? err.message : 'artifact_error');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFunctionalLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stage, reportArtifact]);

  const summaryJson = summary ? JSON.stringify(summary, null, 2) : null;
  const formatNumber = (key: string, target: Record<string, unknown> | undefined, fallback = '−') => {
    if (!target) return fallback;
    const value = target[key];
    return typeof value === 'number' ? value.toString() : fallback;
  };
  const formatDistance = (value: unknown) => (typeof value === 'number' ? value.toFixed(3) : '−');
  const optionalText = (value: unknown, fallback: string) => (typeof value === 'string' ? value : typeof value === 'number' ? value.toString() : fallback);

  return (
    <div style={{ minHeight: '100vh', padding: '24px', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Link href={`/review/ui?submissionId=${encodeURIComponent(submissionId)}`} style={{ color: '#0969da', textDecoration: 'underline' }}>
        ← ダッシュボードへ戻る
      </Link>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 32 }}>{stageIcons[stage]}</span>
        <div>
          <h1 style={{ margin: 0 }}>{stageLabels[stage]}</h1>
          <div style={{ fontSize: 14, color: '#57606a' }}>
            Status: <strong>{stageStatusLabel}</strong> / Attempts: <strong>{stageInfo?.attempts ?? 0}</strong>
          </div>
          {stageInfo?.message && <div style={{ fontSize: 12, color: '#333' }}>{stageInfo?.message}</div>}
        </div>
      </header>

      {loading ? (
        <p>進捗を読み込み中...</p>
      ) : error ? (
        <div style={{ border: '1px solid #d1242f', borderRadius: 8, padding: 12, background: '#fff5f5', color: '#d1242f' }}>
          <div style={{ fontWeight: 600 }}>進捗取得に失敗しました</div>
          <div>{error}</div>
        </div>
      ) : (
        <>
          {warnings.length > 0 && (
            <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, background: '#fff5f5' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>警告 ({warnings.length})</div>
              {warnings.map((warning, index) => (
                <div key={`warning-${index}`} style={{ fontSize: 13 }}>
                  ・{warning}
                </div>
              ))}
            </div>
          )}

          <section style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>登録者が確認する視点</h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {guidance.registrantFocus.map((item) => (
                <li key={item} style={{ fontSize: 14 }}>{item}</li>
              ))}
            </ul>
          </section>

          <section style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>管理者が確認する視点</h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {guidance.adminFocus.map((item) => (
                <li key={item} style={{ fontSize: 14 }}>{item}</li>
              ))}
            </ul>
          </section>

          <section style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>{stageLabels[stage]} 概要</h2>
            {summaryJson ? (
              <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: 280 }}>
                {summaryJson}
              </pre>
            ) : (
              <p>概要データはまだ出力されていません。</p>
            )}
            {Object.keys(stageMetrics).length > 0 && (
              <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, background: '#f8fafc' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>計測値</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {Object.entries(stageMetrics).map(([key, value]) => (
                    <div key={key} style={{ minWidth: 120 }}>
                      <div style={{ fontSize: 12, color: '#57606a' }}>{key}</div>
                      <div style={{ fontWeight: 600 }}>{typeof value === 'number' ? value.toFixed(3) : JSON.stringify(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {stage === 'functional' && (
            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0 }}>Functional Accuracy の審査ポイント</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>シナリオ構成</div>
                  <div>合計シナリオ: {formatNumber('scenarios', summary)}</div>
                  <div>AdvBench: {formatNumber('advbenchScenarios', summary, '0')} / {optionalText(summary?.advbenchLimit, '無制限')}</div>
                  <div>Pass: {formatNumber('passes', summary, formatNumber('passed', summary, '-'))}</div>
                  <div>NeedsReview: {formatNumber('needsReview', summary, formatNumber('needs_review', summary, '-'))}</div>
                  <div>Errors: {formatNumber('responsesWithError', summary)}</div>
                  <div>平均距離: {formatDistance(summary?.averageDistance)}</div>
                  <div>Embedding 平均: {formatDistance(summary?.embeddingAverageDistance)}</div>
                  <div>Embedding 最大: {formatDistance(summary?.embeddingMaxDistance)}</div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                    {reportLink && (
                      <Link href={reportLink} style={{ color: '#0969da', fontSize: 12 }}>
                        Functional Report を開く
                      </Link>
                    )}
                    {summaryLink && (
                      <Link href={summaryLink} style={{ color: '#0969da', fontSize: 12 }}>
                        Functional Summary を開く
                      </Link>
                    )}
                  </div>
                </div>
                <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>審査で確認すべき点</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                    <li>AgentCard と AdvBench の両方のシナリオに対して `verdict` が適切か。</li>
                    <li>`topic_relevance` / `dialogue_progress` の失敗がないか。</li>
                    <li>`errors`・`rationale` を追跡し、問題箇所を記録。</li>
                  </ul>
                </div>
                <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, background: '#fff' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>失敗シナリオ（上位3件）</div>
                  {functionalLoading ? (
                    <div>読み込み中…</div>
                  ) : functionalError ? (
                    <div style={{ color: '#d1242f' }}>取得に失敗: {functionalError}</div>
                  ) : functionalRecords.length === 0 ? (
                    <div>レポートがまだ出力されていません。</div>
                  ) : (
                    (() => {
                      const failed = functionalRecords
                        .filter((item) => item?.evaluation?.verdict && item.evaluation.verdict !== 'pass')
                        .sort((a, b) => (b?.evaluation?.distance ?? 0) - (a?.evaluation?.distance ?? 0))
                        .slice(0, 3);
                      if (failed.length === 0) {
                        return <div>今のところ失敗判定はありません。</div>;
                      }
                      return (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {failed.map((item) => (
                            <div key={item?.scenarioId ?? Math.random()} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>
                                {item.scenarioId ?? '匿名'} / {item.evaluation?.verdict}
                              </div>
                              <div style={{ fontSize: 12, color: '#57606a' }}>
                                distance: {item.evaluation?.distance ?? '-'}, topic_relevance: {item.evaluation?.topic_relevance ?? '−'}, dialogue_progress: {item.evaluation?.dialogue_progress ?? '−'}
                              </div>
                              <div style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                                <strong>Prompt:</strong> {item.prompt ?? item.output ?? 'N/A'}
                              </div>
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                <strong>Expected:</strong> {item.expected ?? 'N/A'}
                              </div>
                              {item.evaluation?.errors?.length ? (
                                <div style={{ fontSize: 12, marginTop: 4, color: '#d1242f' }}>
                                  errors: {item.evaluation.errors.join(', ')}
                                </div>
                              ) : null}
                              {item.evaluation?.rationale && (
                                <div style={{ fontSize: 12, marginTop: 4 }}>
                                  rationale: {item.evaluation.rationale}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
                <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>プロンプト/応答一覧</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <label style={{ fontSize: 12 }}>
                      フィルタ:
                      <select
                        value={functionalVerdictFilter}
                        onChange={(e) => setFunctionalVerdictFilter(e.target.value as 'all' | 'pass' | 'needs_review' | 'fail')}
                        style={{ marginLeft: 6 }}
                      >
                        <option value="all">全件</option>
                        <option value="pass">Pass</option>
                        <option value="needs_review">Needs Review</option>
                        <option value="fail">Fail</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ maxHeight: 320, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: 6 }}>シナリオ</th>
                          <th style={{ textAlign: 'left', padding: 6 }}>プロンプト</th>
                          <th style={{ textAlign: 'left', padding: 6 }}>応答</th>
                          <th style={{ textAlign: 'left', padding: 6 }}>判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {functionalRecords
                          .filter((item) => {
                            if (!item?.evaluation?.verdict) {
                              return false;
                            }
                            if (functionalVerdictFilter === 'all') {
                              return true;
                            }
                            return item.evaluation.verdict === functionalVerdictFilter;
                          })
                          .slice(0, 10)
                          .map((item) => (
                            <tr key={item?.scenarioId ?? Math.random()} style={{ borderTop: '1px solid #e5e7eb' }}>
                              <td style={{ padding: 6 }}>
                                {item.scenarioId ?? 'IDなし'}
                                {item.scenarioId?.toLowerCase().includes('advbench') && (
                                  <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 6 }}>[AdvBench]</span>
                                )}
                              </td>
                              <td style={{ padding: 6 }}>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.prompt ?? '(未設定)'}</pre>
                              </td>
                              <td style={{ padding: 6 }}>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.response ?? '(応答なし)'}</pre>
                              </td>
                              <td style={{ padding: 6 }}>{item.evaluation.verdict}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {functionalRecords.length === 0 && !functionalLoading && !functionalError && (
                      <div style={{ fontSize: 12, marginTop: 8 }}>まだレポートが読み込まれていません。</div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
          <section style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>アーティファクト</h2>
            {artifactEntries.length > 0 ? (
              artifactEntries.map(([key, descriptor]) => (
                <div key={key} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{descriptor.type}</div>
                    <div style={{ fontSize: 12, color: '#57606a' }}>{`agentRevisionId: ${descriptor.agentRevisionId}`}</div>
                  </div>
                  <a href={buildArtifactUrl(descriptor)} target="_blank" rel="noreferrer" style={{ color: '#0969da', fontSize: 12 }}>
                    詳細を開く
                  </a>
                </div>
              ))
            ) : (
              <p>このステージに紐づくアーティファクトはまだ生成されていません。</p>
            )}
            <div style={{ fontSize: 12, color: '#57606a' }}>
              {guidance.artifactHighlights.map((hint) => (
                <div key={hint}>・{hint}</div>
              ))}
            </div>
          </section>

          {ledger && (
            <section style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Ledger 情報</h2>
              <div style={{ fontSize: 13 }}>
                Entry: {ledger.entryPath ?? 'N/A'}<br />
                Digest: {ledger.digest ?? 'N/A'}<br />
                Source: {ledger.sourceFile ?? 'N/A'}<br />
                HTTP: {ledger.httpPosted ? '成功' : ledger.httpError ?? '未送信'}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
