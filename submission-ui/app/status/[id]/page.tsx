'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated, authenticatedFetch } from '@/lib/auth';

type StageName = 'precheck' | 'security_gate' | 'functional_accuracy' | 'judge' | 'human_review';

type StageInfo = {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_review';
  data?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
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

type ProgressData = {
  terminalState: string;
  stages: Record<StageName, StageInfo>;
  trustScore?: TrustScoreBreakdown;
  agentId?: string;
  agentRevisionId?: string;
};

export default function StatusPage() {
  const params = useParams();
  const router = useRouter();
  const submissionId = params.id as string;

  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push(`/login?redirect=/status/${submissionId}`);
      return;
    }

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

    const fetchProgress = async () => {
      try {
        const response = await authenticatedFetch(`${apiBaseUrl}/api/submissions/${submissionId}/progress`);

        if (!response.ok) {
          throw new Error(`エラー: ${response.status}`);
        }

        const data = await response.json();
        setProgress(data);
        setIsLoading(false);

        // If not in terminal state, continue polling
        if (!['approved', 'rejected', 'failed'].includes(data.terminalState)) {
          setTimeout(fetchProgress, 3000); // Poll every 3 seconds
        }
      } catch (err) {
        console.error('Failed to fetch progress:', err);
        setError(err instanceof Error ? err.message : '進捗情報の取得に失敗しました');
        setIsLoading(false);
      }
    };

    fetchProgress();
  }, [submissionId, router]);

  const getStageLabel = (stage: StageName): string => {
    const labels: Record<StageName, string> = {
      precheck: 'PreCheck',
      security_gate: 'Security Gate',
      functional_accuracy: 'Functional Accuracy',
      judge: 'Judge Panel',
      human_review: 'Human Review',
    };
    return labels[stage];
  };

  const getStatusBadge = (status: StageInfo['status']) => {
    const badges = {
      pending: { label: '待機中', color: 'bg-gray-200 text-gray-700' },
      running: { label: '実行中', color: 'bg-blue-200 text-blue-800' },
      completed: { label: '完了', color: 'bg-green-200 text-green-800' },
      failed: { label: '失敗', color: 'bg-red-200 text-red-800' },
      awaiting_review: { label: 'レビュー待ち', color: 'bg-yellow-200 text-yellow-800' },
    };

    const badge = badges[status];
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  const getTerminalStateBadge = (state: string) => {
    switch (state) {
      case 'approved':
        return <span className="px-4 py-2 text-lg font-semibold bg-green-100 text-green-800 rounded-full">✅ 承認</span>;
      case 'rejected':
        return <span className="px-4 py-2 text-lg font-semibold bg-red-100 text-red-800 rounded-full">❌ リジェクト</span>;
      case 'failed':
        return <span className="px-4 py-2 text-lg font-semibold bg-red-100 text-red-800 rounded-full">❌ 失敗</span>;
      case 'running':
        return <span className="px-4 py-2 text-lg font-semibold bg-blue-100 text-blue-800 rounded-full">🔄 評価中</span>;
      default:
        return <span className="px-4 py-2 text-lg font-semibold bg-gray-100 text-gray-800 rounded-full">⏳ 待機中</span>;
    }
  };

  const getAutoDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'auto_approved':
        return <span className="px-3 py-1 text-sm font-semibold bg-green-100 text-green-800 rounded-full">✅ 自動承認</span>;
      case 'auto_rejected':
        return <span className="px-3 py-1 text-sm font-semibold bg-red-100 text-red-800 rounded-full">❌ 自動リジェクト</span>;
      case 'requires_human_review':
        return <span className="px-3 py-1 text-sm font-semibold bg-yellow-100 text-yellow-800 rounded-full">👤 人間レビュー必要</span>;
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <div className="text-red-600 text-center mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-2xl font-bold mb-2">エラー</h2>
            <p className="text-gray-700">{error}</p>
          </div>
          <Link href="/" className="block text-center text-blue-600 hover:underline mt-4">
            ホームに戻る
          </Link>
        </div>
      </div>
    );
  }

  if (!progress) {
    return null;
  }

  const stages: StageName[] = ['precheck', 'security_gate', 'functional_accuracy', 'judge', 'human_review'];

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:underline text-sm">
            ← ホームに戻る
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                登録状況
              </h1>
              <p className="text-sm text-gray-500">Submission ID: {submissionId}</p>
            </div>
            {getTerminalStateBadge(progress.terminalState)}
          </div>

          {progress.agentId && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Agent ID:</span> {progress.agentId}
              </p>
              {progress.agentRevisionId && (
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">Revision ID:</span> {progress.agentRevisionId}
                </p>
              )}
            </div>
          )}

          {/* Trust Score Display */}
          {progress.trustScore && (
            <div className="mb-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-200">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">信頼性スコア</h2>
                {getAutoDecisionBadge(progress.trustScore.autoDecision)}
              </div>

              <div className="flex items-baseline mb-4">
                <span className="text-5xl font-bold text-indigo-600">{progress.trustScore.total}</span>
                <span className="text-2xl text-gray-600 ml-2">/ 100</span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold text-gray-700">セキュリティ:</span>{' '}
                  <span className="text-gray-900">{progress.trustScore.security} / 30</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-700">機能性:</span>{' '}
                  <span className="text-gray-900">{progress.trustScore.functional} / 40</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-700">品質評価:</span>{' '}
                  <span className="text-gray-900">{progress.trustScore.judge} / 20</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-700">実装品質:</span>{' '}
                  <span className="text-gray-900">{progress.trustScore.implementation} / 10</span>
                </div>
              </div>
            </div>
          )}

          {/* Stage Progress */}
          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">評価ステージ</h3>

            {stages.map((stageName) => {
              const stage = progress.stages[stageName];
              if (!stage) return null;

              return (
                <div key={stageName} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-800">{getStageLabel(stageName)}</h4>
                      {stage.startedAt && (
                        <p className="text-xs text-gray-500 mt-1">
                          開始: {new Date(stage.startedAt).toLocaleString('ja-JP')}
                        </p>
                      )}
                      {stage.completedAt && (
                        <p className="text-xs text-gray-500">
                          完了: {new Date(stage.completedAt).toLocaleString('ja-JP')}
                        </p>
                      )}
                    </div>
                    {getStatusBadge(stage.status)}
                  </div>

                  {stage.error && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                      <p className="text-sm text-red-800">{stage.error}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Help Section */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            評価プロセスについて
          </h3>
          <p className="text-sm text-blue-800 mb-4">
            エージェントの信頼性を複数の観点から評価しています。
          </p>
          <ul className="text-sm text-blue-800 space-y-2">
            <li><strong>PreCheck:</strong> エージェントカードの検証と基本情報の確認</li>
            <li><strong>Security Gate:</strong> プロンプトインジェクション耐性テスト（0-30点）</li>
            <li><strong>Functional Accuracy:</strong> エージェントの機能正確性テスト（0-40点）</li>
            <li><strong>Judge Panel:</strong> LLMによる総合品質評価（0-20点）</li>
            <li><strong>実装品質:</strong> コード品質とベストプラクティス（0-10点）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
