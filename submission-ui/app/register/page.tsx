'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, isAuthenticated, authenticatedFetch } from '@/lib/auth';

export default function RegisterPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [formData, setFormData] = useState({
    agentCardUrl: '',
    endpointUrl: '',
    signatureBundle: null as File | null,
  });

  // Check authentication on mount
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login?redirect=/register');
    } else {
      setIsLoading(false);
    }
  }, [router]);

  const [validationErrors, setValidationErrors] = useState({
    agentCardUrl: '',
    endpointUrl: '',
  });

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const validateField = (name: string, value: string) => {
    let errorMessage = '';

    switch (name) {
      case 'agentCardUrl':
        if (!value.trim()) {
          errorMessage = 'エージェントカードURLを入力してください';
        } else if (!validateUrl(value)) {
          errorMessage = '有効なURLを入力してください（例: https://example.com/agent-card.json）';
        }
        break;
      case 'endpointUrl':
        if (!value.trim()) {
          errorMessage = 'エンドポイントURLを入力してください';
        } else if (!validateUrl(value)) {
          errorMessage = '有効なURLを入力してください（例: https://api.example.com/agent）';
        }
        break;
    }

    setValidationErrors(prev => ({ ...prev, [name]: errorMessage }));
    return errorMessage === '';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    validateField(name, value);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFormData(prev => ({ ...prev, signatureBundle: e.target.files![0] }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate all fields
    const agentCardValid = validateField('agentCardUrl', formData.agentCardUrl);
    const endpointValid = validateField('endpointUrl', formData.endpointUrl);

    if (!agentCardValid || !endpointValid) {
      setError('入力内容にエラーがあります。修正してください。');
      return;
    }

    // Get current user info
    const user = getCurrentUser();
    if (!user || !user.organization_id) {
      setError('ログイン情報が取得できません。再度ログインしてください。');
      router.push('/login?redirect=/register');
      return;
    }

    setIsSubmitting(true);

    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

      const submitData = new FormData();
      submitData.append('agentCardUrl', formData.agentCardUrl);
      submitData.append('endpointUrl', formData.endpointUrl);
      submitData.append('organization_id', user.organization_id);

      if (formData.signatureBundle) {
        submitData.append('signatureBundle', formData.signatureBundle);
      }

      const response = await authenticatedFetch(`${apiBaseUrl}/api/submissions`, {
        method: 'POST',
        body: submitData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'エラーが発生しました' }));
        throw new Error(errorData.error || `サーバーエラー: ${response.status}`);
      }

      const result = await response.json();

      // Redirect to status page
      router.push(`/status/${result.submissionId}`);
    } catch (err) {
      console.error('Submission error:', err);
      setError(err instanceof Error ? err.message : '登録に失敗しました。もう一度お試しください。');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">認証確認中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:underline text-sm">
            ← ホームに戻る
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            エージェント登録
          </h1>
          <p className="text-gray-600 mb-8">
            AIエージェントの情報を入力して、信頼性評価を開始します。
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              {/* Agent Card URL */}
              <div>
                <label htmlFor="agentCardUrl" className="block text-sm font-medium text-gray-700 mb-2">
                  エージェントカードURL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  id="agentCardUrl"
                  name="agentCardUrl"
                  value={formData.agentCardUrl}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    validationErrors.agentCardUrl ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="https://example.com/agent-card.json"
                />
                {validationErrors.agentCardUrl && (
                  <p className="mt-1 text-sm text-red-600">{validationErrors.agentCardUrl}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  エージェントの仕様を記述したAgent Card（JSON）のURL
                </p>
              </div>

              {/* Endpoint URL */}
              <div>
                <label htmlFor="endpointUrl" className="block text-sm font-medium text-gray-700 mb-2">
                  エンドポイントURL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  id="endpointUrl"
                  name="endpointUrl"
                  value={formData.endpointUrl}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    validationErrors.endpointUrl ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="https://api.example.com/agent"
                />
                {validationErrors.endpointUrl && (
                  <p className="mt-1 text-sm text-red-600">{validationErrors.endpointUrl}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  エージェントAPIのエンドポイントURL
                </p>
              </div>

              {/* Signature Bundle (Optional) */}
              <div>
                <label htmlFor="signatureBundle" className="block text-sm font-medium text-gray-700 mb-2">
                  署名バンドル（オプション）
                </label>
                <input
                  type="file"
                  id="signatureBundle"
                  name="signatureBundle"
                  onChange={handleFileChange}
                  accept=".json,.zip,.tar.gz"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500">
                  エージェントの署名検証用ファイル（JSON, ZIP, または TAR.GZ形式）
                </p>
              </div>
            </div>

            <div className="mt-8 flex gap-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`flex-1 py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
                  isSubmitting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isSubmitting ? '登録中...' : '登録する'}
              </button>
              <Link
                href="/"
                className="px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </Link>
            </div>
          </form>
        </div>

        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            登録後の流れ
          </h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>セキュリティゲート（プロンプトインジェクション耐性テスト）</li>
            <li>機能評価（エージェントの機能正確性テスト）</li>
            <li>品質評価（LLM Judge Panelによる総合評価）</li>
            <li>信頼性スコア算出（0-100点）</li>
            <li>自動判定（承認/リジェクト/人間レビュー）</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
