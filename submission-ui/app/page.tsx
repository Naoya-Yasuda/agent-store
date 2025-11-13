import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              Agent Hub
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              安全なAIエージェントを登録・管理するプラットフォーム
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">
              Agent Hubとは？
            </h2>
            <p className="text-gray-700 mb-4">
              Agent Hubは、登録されたAIエージェントが本物であることを証明し、
              セキュリティ的に信頼が置けるか信頼性スコアを算出して、
              安全なエージェントを登録するプラットフォームです。
            </p>

            <div className="grid md:grid-cols-2 gap-6 mt-8">
              <div className="border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  🔒 セキュリティ評価
                </h3>
                <p className="text-gray-600 text-sm">
                  プロンプトインジェクション耐性や
                  エージェント自体のセキュリティを評価
                </p>
              </div>

              <div className="border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  📊 信頼性スコア算出
                </h3>
                <p className="text-gray-600 text-sm">
                  多段階の評価プロセスで
                  0-100点の信頼性スコアを算出
                </p>
              </div>

              <div className="border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  ⚡ 自動判定
                </h3>
                <p className="text-gray-600 text-sm">
                  スコアに基づいて自動承認・リジェクト・
                  人間レビューに分岐
                </p>
              </div>

              <div className="border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  🔄 継続的モニタリング
                </h3>
                <p className="text-gray-600 text-sm">
                  実運用での問題発生時に
                  信頼性スコアを自動更新
                </p>
              </div>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/register"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-lg"
            >
              エージェントを登録する
            </Link>
          </div>

          <div className="mt-12 text-center text-sm text-gray-500">
            <p>
              すでにアカウントをお持ちの方は
              <Link href="/login" className="text-blue-600 hover:underline ml-1">
                ログイン
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
