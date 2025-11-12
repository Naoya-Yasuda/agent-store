# Docker Compose クイックスタートガイド

このガイドでは、Docker Composeを使ってAgent Storeの全サービスを一括で起動し、A2Aエージェントの登録から審査までをテストする手順を説明します。

## 前提条件

- Docker Desktop がインストールされていること
- Docker Compose が利用可能であること（Docker Desktop に含まれています）
- 8GB以上のメモリが利用可能であること

## クイックスタート

### 1. リポジトリのクローン（既にクローン済みの場合はスキップ）

```bash
git clone https://github.com/your-org/agent-store.git
cd agent-store
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

必要に応じて`.env`ファイルを編集してください。デフォルト設定でも動作します。

### 3. AdvBenchデータセットのセットアップ

Security Gate（攻撃プロンプトテスト）に必要なデータセットをダウンロードします：

```bash
bash scripts/setup_aisev.sh
```

### 4. 全サービスの起動

```bash
docker-compose up -d
```

初回起動時は、Dockerイメージのビルドに5〜10分程度かかります。

### 5. サービスの起動確認

```bash
# 全コンテナの状態を確認
docker-compose ps

# ログをリアルタイムで確認
docker-compose logs -f

# 特定のサービスのログを確認
docker-compose logs -f api
docker-compose logs -f temporal-worker
```

### 6. サービスへのアクセス

すべてのサービスが起動したら、以下のURLでアクセスできます：

- **API Health Check**: http://localhost:3000/health
- **API Catalog**: http://localhost:3000/api/public/catalog
- **Review UI**: http://localhost:3001
- **Temporal UI**: http://localhost:8233

## エージェント登録のテスト

### 1. テスト用AgentCardの準備

```json
{
  "id": "test-agent-001",
  "name": "Test Weather Agent",
  "description": "天気情報を提供するテストエージェント",
  "endpoint": "https://your-test-endpoint.example.com",
  "useCases": [
    {
      "category": "weather",
      "description": "現在の天気を取得",
      "input": "東京の天気は？",
      "expectedOutput": "現在の東京の天気情報"
    }
  ],
  "providerId": "test-provider-001"
}
```

### 2. Submission APIでエージェントを登録

```bash
curl -X POST http://localhost:3000/api/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "endpointUrl": "https://your-test-endpoint.example.com",
    "agentCard": {
      "id": "test-agent-001",
      "name": "Test Weather Agent",
      "description": "天気情報を提供するテストエージェント",
      "useCases": [
        {
          "category": "weather",
          "description": "現在の天気を取得"
        }
      ]
    },
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    "providerId": "test-provider-001",
    "telemetry": {
      "wandb": {
        "enabled": true,
        "project": "agent-store-sandbox",
        "entity": "local"
      },
      "llmJudge": {
        "enabled": true,
        "model": "gpt-4o-mini",
        "provider": "openai",
        "dryRun": true
      }
    }
  }'
```

レスポンスから`submissionId`を取得します。

### 3. 審査状況の確認

```bash
# REST APIで進捗確認
curl http://localhost:3000/api/review/progress/{submissionId}

# ブラウザでHuman Review UIにアクセス
open http://localhost:3001/review/{submissionId}
```

## サービスの管理

### サービスの停止

```bash
# サービスを停止（データは保持）
docker-compose stop

# サービスを停止してコンテナを削除（データは保持）
docker-compose down
```

### データの完全削除

```bash
# コンテナ、ネットワーク、ボリュームをすべて削除
docker-compose down -v
```

### 特定のサービスの再起動

```bash
# APIサーバのみ再起動
docker-compose restart api

# Temporal Workerのみ再起動
docker-compose restart temporal-worker
```

### ログの確認

```bash
# 全サービスのログを表示
docker-compose logs

# 最新100行のログを表示
docker-compose logs --tail=100

# リアルタイムでログを追跡
docker-compose logs -f

# 特定のサービスのログのみ表示
docker-compose logs -f api temporal-worker
```

## トラブルシューティング

### ポートが既に使用されている

エラー: `Bind for 0.0.0.0:3000 failed: port is already allocated`

**解決方法**: `docker-compose.yml`でポート番号を変更してください：

```yaml
services:
  api:
    ports:
      - "3100:3000"  # ホストポートを3100に変更
```

### コンテナが起動しない

```bash
# コンテナの詳細状態を確認
docker-compose ps -a

# 特定のコンテナのログを確認
docker-compose logs api

# コンテナを完全にクリーンアップして再ビルド
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

### データベース接続エラー

PostgreSQLコンテナが完全に起動するまで待ちます：

```bash
# PostgreSQLの起動状態を確認
docker-compose logs postgres

# ヘルスチェックの状態を確認
docker inspect agent-store-postgres | grep -A 10 Health
```

### Temporal接続エラー

Temporalサーバが起動するまで時間がかかる場合があります：

```bash
# Temporalサーバのログを確認
docker-compose logs temporal

# Temporal UIにアクセスして状態確認
open http://localhost:8233
```

## 開発モードでの起動

開発時には、ホットリロードを有効にした起動も可能です：

```bash
# docker-compose.override.ymlを作成
cat > docker-compose.override.yml << 'EOF'
version: '3.9'
services:
  api:
    volumes:
      - ./api:/app/api
    command: ["npm", "run", "dev"]

  review-ui:
    volumes:
      - ./review-ui:/app
    command: ["npm", "run", "dev"]
EOF

# 開発モードで起動
docker-compose up -d
```

## その他のリソース

- [メインREADME](README.md) - プロジェクトの全体概要
- [AGENTS.md](AGENTS.md) - コントリビュータガイド
- [docs/](docs/) - 設計ドキュメント

## サポート

問題が発生した場合は、以下を確認してください：

1. Dockerのバージョン: `docker --version`（20.10以上推奨）
2. Docker Composeのバージョン: `docker-compose --version`（2.0以上推奨）
3. 利用可能なメモリ: Docker Desktopの設定で8GB以上を割り当て
4. ログの確認: `docker-compose logs`
