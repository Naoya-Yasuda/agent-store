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

type TrustScoreCardProps = {
  trustScore?: TrustScoreBreakdown;
};

export function TrustScoreCard({ trustScore }: TrustScoreCardProps) {
  if (!trustScore) {
    return (
      <div className="p-4 bg-gray-50 rounded border border-gray-200">
        <p className="text-sm text-gray-500">信頼性スコア: 算出中...</p>
      </div>
    );
  }

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'auto_approved':
        return (
          <span className="px-3 py-1 text-sm font-semibold text-green-800 bg-green-100 rounded-full">
            ✅ 自動承認
          </span>
        );
      case 'auto_rejected':
        return (
          <span className="px-3 py-1 text-sm font-semibold text-red-800 bg-red-100 rounded-full">
            ❌ 自動リジェクト
          </span>
        );
      case 'requires_human_review':
        return (
          <span className="px-3 py-1 text-sm font-semibold text-yellow-800 bg-yellow-100 rounded-full">
            👤 人間レビュー必要
          </span>
        );
      default:
        return null;
    }
  };

  const getScoreColor = (score: number, maxScore: number) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const ScoreBar = ({ label, score, maxScore, reasoning }: { label: string; score: number; maxScore: number; reasoning?: string }) => {
    const percentage = (score / maxScore) * 100;
    const colorClass = getScoreColor(score, maxScore);

    return (
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <span className="text-sm font-semibold text-gray-900">
            {score} / {maxScore}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`${colorClass} h-3 rounded-full transition-all duration-300`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {reasoning && (
          <p className="text-xs text-gray-600 mt-1">{reasoning}</p>
        )}
      </div>
    );
  };

  return (
    <div className="mb-6 p-6 bg-white rounded-lg border-2 border-gray-300 shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-900">信頼性スコア</h2>
        {getDecisionBadge(trustScore.autoDecision)}
      </div>

      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg">
        <div className="flex items-baseline">
          <span className="text-5xl font-bold text-indigo-600">{trustScore.total}</span>
          <span className="text-2xl text-gray-600 ml-2">/ 100</span>
        </div>
        <p className="text-sm text-gray-600 mt-1">総合信頼性スコア</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">スコア内訳</h3>

        <ScoreBar
          label="セキュリティ (Security Gate)"
          score={trustScore.security}
          maxScore={30}
          reasoning={trustScore.reasoning.security}
        />

        <ScoreBar
          label="機能性 (Functional Accuracy)"
          score={trustScore.functional}
          maxScore={40}
          reasoning={trustScore.reasoning.functional}
        />

        <ScoreBar
          label="品質評価 (Judge Panel)"
          score={trustScore.judge}
          maxScore={20}
          reasoning={trustScore.reasoning.judge}
        />

        <ScoreBar
          label="実装品質 (Implementation)"
          score={trustScore.implementation}
          maxScore={10}
          reasoning={trustScore.reasoning.implementation}
        />
      </div>

      <div className="mt-4 p-3 bg-blue-50 rounded border-l-4 border-blue-400">
        <p className="text-sm text-blue-900">
          <strong>判定基準:</strong>
          スコア &lt; 40 = 自動リジェクト |
          スコア 40-79 = 人間レビュー |
          スコア ≥ 80 = 自動承認
        </p>
      </div>
    </div>
  );
}
