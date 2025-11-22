# Trusted Agent Hub (Python/FastAPI Edition)

**Trusted Agent Hub** は、AIエージェントの登録・審査・公開を行うためのプラットフォームです。
本バージョンでは、Python (FastAPI) + SQLite + Jinja2 を使用した単一コンテナ構成にリライトされました。

## 🚀 特徴

- **単一コンテナ**: API、UI、Worker、DBを1つのDockerコンテナに集約。デプロイと管理が容易です。
- **Pythonネイティブ**: 全てのロジックをPythonで記述。型ヒントとPydanticによる堅牢な設計。
- **埋め込みDB**: SQLiteを使用し、外部DBサーバーへの依存を排除（PoC向け）。
- **サーバーサイドレンダリング**: Jinja2テンプレートを使用した高速なUI描画。

## 🛠️ アーキテクチャ

```
trusted_agent_hub/
├── app/
│   ├── main.py         # FastAPI アプリケーションエントリーポイント
│   ├── models.py       # SQLAlchemy データベースモデル
│   ├── schemas.py      # Pydantic スキーマ
│   ├── routers/        # API ルーター (Submissions, Reviews, UI)
│   └── templates/      # Jinja2 HTML テンプレート
├── static/             # 静的ファイル (CSS, JS)
├── Dockerfile          # Docker イメージ定義
└── requirements.txt    # Python 依存関係
```

## 📦 起動方法

### 1. ビルド & 起動

```bash
cd trusted_agent_hub
docker build -t trusted-agent-hub .
docker run -p 8080:8080 trusted-agent-hub
```

### 2. アクセス

- **ホーム**: http://localhost:8080
- **エージェント提出**: http://localhost:8080/submit
- **管理ダッシュボード**: http://localhost:8080/admin

## 🧪 審査フロー

### 提出方法

1.  **提出 (Submission)**: ユーザーがAgent Card URLを提出します。

    **提出UI**: `http://localhost:8080/submit`

    **入力項目**:
    - **Agent Card URL**: A2A Protocol準拠のAgent Card JSONのURL
      - サンプルエージェントの場合: `http://sample-agent:4000/agent-card.json`
      - **必須フィールド**: `agentId`, `serviceUrl`, `translations`

    **コンテナ情報**:
    - **コンテナ名**: `trusted-agent-hub`
    - **ポート**: `8080:8080`
    - **ネットワーク**: `agent-hub_agent-hub-network`
    - **注意**: `sample-agent` と通信するため、同じネットワークに接続されている必要があります

    **Agent Card仕様 (A2A Protocol)**:
    - `agentId`: エージェントの一意識別子（自動抽出）
    - `serviceUrl`: エージェントとの対話エンドポイント（例: `http://sample-agent:4000/agent/chat`）
    - `translations[0].displayName`: エージェントの表示名
    - `translations[0].shortDescription`: エージェントの短い説明
    - `skills`: エージェントが提供するスキル一覧
    - `capabilities`: ストリーミング、通知などの機能フラグ

2.  **自動審査 (Automated Review)**: バックグラウンドワーカーが自動的に以下のスコアを算出します。
    - **Security Score**: `sandbox-runner` を使用した実際のセキュリティ攻撃テスト（AdvBench/AISI）
    - **Functional Score**: Agent Cardの `skills` に基づく機能テスト
    - **Trust Score**: 上記スコアの合計値

    **審査プロセス**:
    - Agent Cardから `serviceUrl` を抽出し、エージェントエンドポイントに接続
    - セキュリティゲート: 攻撃プロンプトを送信し、エージェントの応答を評価
    - 機能チェック: スキルごとにテストシナリオを実行
    - スコアに基づき自動判定（承認/拒否/要人間レビュー）を実施

3.  **判定 (Decision)**:
    - スコアが低い場合: **自動拒否 (Auto Rejected)**
    - スコアが高い場合: **要人間レビュー (Requires Human Review)**
4.  **人間レビュー (Human Review)**: 管理者がダッシュボードから承認/拒否を最終決定します。

## 📂 ディレクトリ構成

- `trusted_agent_hub/`: メインアプリケーション
- `sample-agent/`: テスト用サンプルエージェント
- `sandbox-runner/`: エージェント実行ランナー（ライブラリとして使用）

## ⚠️ 注意事項

- 本環境はPoC（概念実証）用です。
- データベースはコンテナ内のSQLiteファイル(`agent_hub.db`)を使用するため、コンテナを削除するとデータも消えます。永続化が必要な場合はボリュームをマウントしてください。
