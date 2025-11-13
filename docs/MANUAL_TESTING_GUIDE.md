# Agent Store - 手動テスト手順書

## 📋 前提条件

すべてのサービスが起動していることを確認：
```bash
docker compose ps
```

期待される出力: 以下の7つのサービスが`Up`または`Running`状態
- agent-store-api
- agent-store-postgres
- agent-store-temporal-postgres
- agent-store-temporal
- agent-store-temporal-ui (**Temporal Web UI**)
- agent-store-temporal-worker
- agent-store-review-ui

### Python環境の確認

Temporal WorkerとInspect WorkerがPython 3.13を使用していることを確認：
```bash
# Temporal WorkerのPythonバージョン確認
docker exec agent-store-temporal-worker python3 --version

# Inspect WorkerのPythonバージョン確認
docker run --rm --entrypoint python3 agent-store-inspect-worker --version
```

期待される出力:
```
Python 3.13.9
```

### オプション機能の設定（W&B、LLM APIキー）

完全なE2Eテストを実行する場合、以下のAPIキーを設定できます：

#### 1. Weights & Biases (W&B) の設定

W&Bでメトリクスをトラッキングする場合：

```bash
# .envファイルを編集
nano .env  # または vim .env

# 以下の行のコメントを外して設定
# WANDB_API_KEY=your-wandb-api-key-here
```

W&Bを使わない場合は、`WANDB_DISABLED=true` に設定してください（デフォルトは`false`）。

#### 2. LLM APIキーの設定（Judge Panel用）

Judge Panelステージで自動判定を有効にする場合：

```bash
# .envファイルを編集
nano .env

# 以下の行のコメントを外して設定
# OPENAI_API_KEY=sk-your-openai-key-here
# または
# ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
```

**注意:**
- Judge Panelステージは現在のPoCでは**オプション**です
- APIキーを設定しない場合、Judge Panelはスキップされます
- OpenAI GPT-4またはAnthropic Claudeが使用可能です

#### 3. 設定後のサービス再ビルドと再起動

環境変数を変更した後は、**必ず再ビルド**してからサービスを起動してください：

```bash
# サービスを停止
docker compose down

# 環境変数を使用するサービスを再ビルド（重要！）
docker compose build --no-cache api temporal-worker inspect-worker

# 全サービスを起動
docker compose up -d

# ログで設定が反映されているか確認
docker compose logs api | grep -i "WANDB\|API"
docker compose logs temporal-worker | grep -i "WANDB\|API"
docker compose logs inspect-worker | head -20
```

**重要:** `.env`ファイルの変更は、コンテナのビルド時に環境変数として埋め込まれます。そのため、環境変数を変更した場合は、単なる再起動ではなく、`docker compose build`による再ビルドが必要です。

## 🌐 アクセス先URL

| サービス | URL | 用途 |
|---------|-----|------|
| **Review UI** | http://localhost:3001 | レビュー状況の確認・Human Review |
| **API** | http://localhost:3002 | エージェント提出・状態確認 |
| **Temporal Web UI** | http://localhost:8233 | ワークフロー管理・デバッグ |

---

## 📖 用語説明

### Submission（提出物）とは

**Submission**は、Agent Store に登録するために提出されたエージェントの審査申請のことです。

#### 構成要素

1つのSubmissionには以下の情報が含まれます：

- **Agent Card（エージェントカード）**: エージェントのメタデータ
  - 表示名、説明文、機能リスト（capabilities）
  - 実行プロファイル（self_hosted, managed等）
  - 多言語対応情報

- **Endpoint Manifest（エンドポイント仕様書）**: エージェントのAPI仕様
  - OpenAPI 3.0形式
  - 利用可能なエンドポイント一覧
  - リクエスト/レスポンス形式

- **Signature Bundle（署名情報）**: セキュリティ検証用
  - 公開鍵
  - 署名アルゴリズム
  - ペイロードダイジェスト

- **Organization（組織情報）**: 提出元の組織
  - 組織ID、名称
  - 連絡先メールアドレス
  - 運用者の公開鍵

#### レビューパイプライン

各Submissionは以下のステージを順番に通過します：

```
Submission作成
  ↓
① PreCheck（事前チェック）
  ↓
② Security Gate（セキュリティ検査）
  ↓
③ Functional Accuracy（機能精度テスト）
  ↓
④ Judge Panel（自動判定）
  ↓
⑤ Human Review（人間による最終レビュー）
  ↓
⑥ Publish（公開）
```

各ステージで合格すると次のステージに進み、問題があれば差し戻されます。

#### Submission ID

各Submissionには一意の識別子（UUID形式）が付与されます。
例: `9c912c17-c36d-4898-bae9-d768156a6193`

このIDを使って、進捗状況の確認やレビュー結果の取得を行います。

---

## テストシナリオ

### 🧪 シナリオ1: APIヘルスチェック

最も基本的な動作確認です。

```bash
# ヘルスチェック
curl http://localhost:3002/health
```

**期待される出力:**
```json
{"status":"ok","timestamp":"2025-11-13T04:01:13.286Z"}
```

**確認ポイント:**
- ✅ HTTPステータス 200
- ✅ JSONレスポンスに`status: "ok"`が含まれる

---

### 🧪 シナリオ2: Review UIの表示確認

ブラウザで動作を確認します。

1. **Review UIを開く:**
   ```
   http://localhost:3001
   ```

2. **確認ポイント:**
   - ✅ Agent Store Review UIのページが表示される
   - ✅ 初期状態では提出物のリストは空
   - ✅ JavaScriptエラーがコンソールにない（ブラウザのDevToolsで確認）

---

### 🧪 シナリオ3: Temporal Web UIの確認

Temporalのダッシュボードを確認します。

1. **Temporal Web UIを開く:**
   ```
   http://localhost:8233
   ```

2. **確認ポイント:**
   - ✅ Temporalのダッシュボードが表示される
   - ✅ Namespace: `default` が選択されている
   - ✅ Workflowsタブで現在はワークフローが0件

---

### 🧪 シナリオ4: エージェント提出テスト（完全なE2Eテスト）

実際にエージェントを提出してレビューパイプラインを動かします。

#### Step 1: テスト用のSubmissionを準備

```bash
cat > /tmp/test-submission.json << 'EOF'
{
  "agentId": "550e8400-e29b-41d4-a716-446655440001",
  "cardDocument": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "agentId": "550e8400-e29b-41d4-a716-446655440001",
    "defaultLocale": "en",
    "status": "draft",
    "executionProfile": "self_hosted",
    "translations": [
      {
        "locale": "en",
        "displayName": "E2E Test Agent",
        "shortDescription": "An agent for end-to-end browser testing",
        "capabilities": ["text-processing", "data-analysis"]
      }
    ]
  },
  "endpointManifest": {
    "openapi": "3.0.0",
    "info": {
      "title": "Test Agent API",
      "version": "1.0.0"
    },
    "servers": [{"url": "https://example.com/agent"}],
    "paths": {
      "/query": {
        "post": {
          "summary": "Process queries",
          "description": "Handles text processing and data analysis",
          "tags": ["text-processing", "data-analysis"]
        }
      }
    }
  },
  "signatureBundle": {
    "algorithm": "RS256",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----",
    "signature": "test-signature-base64",
    "payloadDigest": "sha256-digest"
  },
  "organization": {
    "organizationId": "test-org-001",
    "name": "Test Organization",
    "contactEmail": "test@example.com",
    "operatorPublicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----"
  }
}
EOF
```

**注意:** `SKIP_SIGNATURE_VERIFICATION=true` 環境変数が設定されている場合、署名検証はスキップされます（開発・テストモード）。

#### Step 2: エージェントを提出

```bash
curl -X POST http://localhost:3002/api/v1/submissions \
  -H "Content-Type: application/json" \
  -d @/tmp/test-submission.json
```

**期待される出力:**
```json
{
  "submissionId": "9c912c17-c36d-4898-bae9-d768156a6193",
  "state": "precheck_pending",
  "manifestWarnings": []
}
```

**確認ポイント:**
- ✅ HTTPステータス 202 (Accepted)
- ✅ `submissionId`が返される（UUIDフォーマット）
- ✅ `state`が`"precheck_pending"`

**⚠️ 重要:** 次のステップのために`submissionId`の値を控えておいてください（例: `9c912c17-c36d-4898-bae9-d768156a6193`）

#### Step 3: Temporal Workflowの確認

1. **Temporal Web UIを開く:**
   ```
   http://localhost:8233
   ```

2. **Workflowsタブを確認:**
   - `review-pipeline-{submissionId}` という名前のワークフローが表示されるはず
   - ステータスが`Running`になっている

3. **ワークフローの詳細を確認:**
   - ワークフロー名をクリック
   - **Event History**タブで各ステージの実行を確認
   - **Pending Activities**で現在実行中のアクティビティを確認
   - **Query**セクションで`queryProgress`を実行して進捗を確認

#### Step 4: Review UIで状態確認

1. **Review UIを開く:**
   ```
   http://localhost:3001
   ```

2. **Submission IDを入力:**
   - ページ上部の「Submission ID」フィールドに、Step 2で取得したSubmission ID（例: `9c912c17-c36d-4898-bae9-d768156a6193`）を入力
   - 「最新の進捗を取得」ボタンをクリック

3. **確認ポイント:**
   - ✅ 証拠ビューアセクションに進捗情報が表示される
   - ✅ ステージ選択プルダウンで各ステージ（PreCheck, Security Gate, Functional Accuracy等）が選択可能
   - ✅ 種別選択プルダウンでLedger/Artifactが選択可能
   - ✅ 各ステージのステータスが確認できる
   - ✅ Human Review決定セクションで承認/差戻しボタンが表示される

#### Step 5: Temporal Workerログでワークフロー実行を確認

```bash
# Step 2で取得したsubmissionIdを使用
SUBMISSION_ID="9c912c17-c36d-4898-bae9-d768156a6193"

# Temporal Workerのログを確認
docker logs agent-store-temporal-worker --tail 50 | grep -A 5 -B 5 "${SUBMISSION_ID}"
```

**期待される出力:**
```
[activities] preCheckSubmission 9c912c17-c36d-4898-bae9-d768156a6193
[activities] runSecurityGate submission=9c912c17-c36d-4898-bae9-d768156a6193
[sandbox-runner] generated artifacts in /app/sandbox-runner/artifacts/9c912c17-c36d-4898-bae9-d768156a6193-rev1
[activities] runFunctionalAccuracy submission=9c912c17-c36d-4898-bae9-d768156a6193
[sandbox-runner] generated artifacts in /app/sandbox-runner/artifacts/9c912c17-c36d-4898-bae9-d768156a6193-rev1
[activities] notifyHumanReview submission=9c912c17-c36d-4898-bae9-d768156a6193 reason=functional_accuracy_failure
```

**確認ポイント:**
- ✅ PreCheck、Security Gate、Functional Accuracyの各ステージが実行されている
- ✅ アーティファクトが生成されている
- ✅ Human Review待機状態になっている（`notifyHumanReview`が呼ばれている）

**注意:** 現在のPoCでは、GETエンドポイント（`GET /api/v1/submissions/{id}`）は未実装です。進捗確認はTemporal UIまたはReview UIから行ってください。

---

### 🧪 シナリオ5: Human Review 承認/差戻しテスト

Human Reviewステージで管理者が承認または差戻しを行うテストです。

**前提条件:**
- シナリオ4でエージェントを提出済み
- ワークフローがHuman Review待機状態になっている

#### Step 1: Review UIでHuman Review待機状態を確認

1. **Review UIを開く:**
   ```
   http://localhost:3001
   ```

2. **Submission IDを入力して進捗を取得:**
   - シナリオ4で取得したSubmission IDを入力
   - 「最新の進捗を取得」ボタンをクリック

3. **Human Review待機状態の確認:**
   - ✅ ステージ選択プルダウンで「human」が選択可能
   - ✅ 「Human Review 決定」セクションが表示されている
   - ✅ 承認ボタンと差戻しボタンが有効になっている

#### Step 2A: 承認パターンのテスト

1. **メモ欄に承認理由を入力（任意）:**
   ```
   すべてのステージが正常に完了したため承認します。
   ```

2. **「承認」ボタンをクリック**

3. **確認ポイント:**
   - ✅ 「決定を送信しました」というメッセージが表示される
   - ✅ Temporal Workerのログに承認処理が記録される

4. **ワークフローの進行を確認:**
   ```bash
   # Temporal Workerのログを確認
   docker logs agent-store-temporal-worker --tail 30
   ```

   **期待される出力:**
   ```
   [activities] human decision received: approved
   [activities] publishToStore submission=...
   ```

5. **Temporal Web UIで最終状態を確認:**
   - http://localhost:8233
   - ワークフローのステータスが`Completed`になっている
   - Event HistoryでPublishステージまで完了していることを確認

#### Step 2B: 差戻しパターンのテスト

別のSubmissionで差戻しをテストします。

1. **新しいSubmissionを作成:**
   ```bash
   # シナリオ4のStep 1-2を実行して新しいSubmissionを作成
   # 新しいSubmission IDを控えておく
   ```

2. **Human Review待機状態になるまで待つ:**
   ```bash
   # ワークフローがHuman Reviewまで進むのを待つ（数秒〜数十秒）
   docker logs agent-store-temporal-worker --tail 30 | grep "notifyHumanReview"
   ```

3. **Review UIで差戻し操作:**
   - メモ欄に差戻し理由を入力:
     ```
     セキュリティ上の懸念があるため差戻します。再提出時には署名を修正してください。
     ```
   - 「差戻し」ボタンをクリック

4. **確認ポイント:**
   - ✅ 「決定を送信しました」というメッセージが表示される
   - ✅ Temporal Workerのログに差戻し処理が記録される

5. **ワークフローの終了を確認:**
   ```bash
   docker logs agent-store-temporal-worker --tail 30
   ```

   **期待される出力:**
   ```
   [activities] human decision received: rejected
   [workflow] terminal state: rejected
   ```

6. **Temporal Web UIで最終状態を確認:**
   - ワークフローのステータスが`Completed`になっている
   - Event Historyで差戻しが記録されている
   - メタデータに差戻し理由が保存されている

#### Step 3: データベースで記録を確認

```bash
# PostgreSQLに接続
docker compose exec postgres psql -U agent_store_user -d agent_store_db

# Human Review決定が記録されているか確認
SELECT id, state, progress->'human' as human_stage
FROM submissions
WHERE id = '<your-submission-id>' \gx

# 終了
\q
```

**確認ポイント:**
- ✅ `state`が`published`（承認の場合）または`rejected`（差戻しの場合）
- ✅ `progress->'human'`にdecisionとdecisionNotesが記録されている

---

### 🧪 シナリオ6: データベース直接確認

PostgreSQLに直接接続して提出データを確認します。

```bash
# PostgreSQLに接続
docker compose exec postgres psql -U agent_store_user -d agent_store_db

# 提出データを確認
SELECT id, state, created_at FROM submissions ORDER BY created_at DESC LIMIT 5;

# エージェントカード情報を確認
SELECT id, agent_id, display_name FROM agent_cards LIMIT 5;

# レビュー進捗を確認（JSONカラム）
SELECT id, state, progress FROM submissions WHERE id = '<your-submission-id>';

# 終了
\q
```

---

## 📊 期待される動作フロー

完全なレビューパイプラインの流れ：

```mermaid
graph LR
    A[Submission] --> B[PreCheck]
    B --> C[Security Gate]
    C --> D[Functional Accuracy]
    D --> E[Judge Panel]
    E --> F[Human Review]
    F --> G[Publish]
```

1. **Submission** → API経由で提出（`POST /v1/submissions`）
2. **PreCheck** → AgentCardのバリデーション（自動）
   - JSON Schemaバリデーション
   - 必須フィールドの確認
3. **Security Gate** → セキュリティスキャン（自動）
   - 署名検証
   - ソースコードのセキュリティチェック
4. **Functional Accuracy** → 機能テスト（Inspect Worker使用）
   - Sandbox Runner実行
   - RAGTruthとの比較
   - メトリクス計算
5. **Judge Panel** → LLMによる自動判定
   - LLM（OpenAI/Anthropic）を使用した品質評価
   - カテゴリ別スコアリング
6. **Human Review** → 人間による最終承認（必要な場合）
   - Review UIから承認/却下
7. **Publish** → Agent Storeへの公開
   - メタデータの更新
   - 公開ステータスの変更

**注意:**
- Functional Accuracyステージは、実際のエージェントコードとSandbox Runnerが必要です
- PoCでは一部のステージがスキップまたはモック動作する可能性があります
- Inspect Workerは`response_samples.jsonl`が存在しない場合はエラーで停止しますが、これは正常な動作です

---

## 🐛 トラブルシューティング

### サービスが起動していない場合

```bash
# すべてのサービスの状態を確認
docker compose ps -a

# 停止しているサービスのログを確認
docker compose logs <service-name>

# すべてのサービスを再起動
docker compose down
docker compose up -d

# リアルタイムでログを確認
docker compose logs -f
```

### APIがエラーを返す場合

```bash
# APIのログを確認
docker logs agent-store-api --tail 100 -f

# データベース接続を確認
docker compose exec postgres psql -U agent_store_user -d agent_store_db -c "\dt"

# ネットワーク接続を確認
docker compose exec api ping -c 3 postgres
docker compose exec api ping -c 3 temporal
```

### Temporal Workerが動作していない場合

```bash
# Temporal Workerのログを確認
docker logs agent-store-temporal-worker --tail 100 -f

# Temporal Serverへの接続を確認
docker compose exec temporal-worker nc -zv temporal 7233

# Worker状態の詳細確認
docker compose exec temporal-worker ps aux
```

### Temporal Workflowが作成されない場合

**考えられる原因:**
1. Temporal Workerが起動していない
2. データベース接続エラー
3. Workflowの起動に失敗している

**確認手順:**
```bash
# 1. Temporal Workerのログを確認
docker logs agent-store-temporal-worker --tail 50

# 2. APIがTemporal Clientを初期化できているか確認
docker logs agent-store-api | grep -i temporal

# 3. Temporal Web UIでエラーを確認
# http://localhost:8233 → Workflows → Filter by Status: Failed
```

### Review UIが空の場合

**考えられる原因:**
1. APIが正しく動作していない
2. データベースにデータが保存されていない
3. フロントエンドのAPIリクエストが失敗している

**確認手順:**
```bash
# 1. ブラウザのDevTools (F12) でネットワークタブを確認
# → /api/submissions へのリクエストが成功しているか

# 2. APIを直接叩いて確認
curl http://localhost:3002/v1/submissions

# 3. データベースを直接確認
docker compose exec postgres psql -U agent_store_user -d agent_store_db \
  -c "SELECT COUNT(*) FROM submissions;"
```

---

## 🔍 デバッグ用コマンド集

### コンテナ内でのコマンド実行

```bash
# API コンテナ内でシェルを起動
docker compose exec api sh

# Temporal Worker コンテナ内でシェルを起動
docker compose exec temporal-worker bash

# PostgreSQLコンテナ内でシェルを起動
docker compose exec postgres sh
```

### ログの確認

```bash
# すべてのサービスのログをリアルタイム表示
docker compose logs -f

# 特定のサービスのログのみ表示
docker compose logs -f api
docker compose logs -f temporal-worker
docker compose logs -f temporal

# 過去100行のログを表示
docker compose logs --tail=100 api
```

### ネットワーク接続の確認

```bash
# APIからPostgreSQLへの接続確認
docker compose exec api nc -zv postgres 5432

# APIからTemporalへの接続確認
docker compose exec api nc -zv temporal 7233

# Temporal WorkerからTemporalへの接続確認
docker compose exec temporal-worker nc -zv temporal 7233
```

### データベースのクエリ

```bash
# 全テーブルの一覧
docker compose exec postgres psql -U agent_store_user -d agent_store_db -c "\dt"

# 提出物の一覧
docker compose exec postgres psql -U agent_store_user -d agent_store_db \
  -c "SELECT id, state, created_at FROM submissions ORDER BY created_at DESC;"

# 特定の提出物の詳細
docker compose exec postgres psql -U agent_store_user -d agent_store_db \
  -c "SELECT * FROM submissions WHERE id = '<submission-id>' \gx"
```

---

## ✅ テスト完了チェックリスト

### 基本動作確認
- [ ] すべてのサービスが起動している（`docker compose ps`で確認）
- [ ] APIヘルスチェックが成功する（`/health`エンドポイント）
- [ ] Review UIがブラウザで表示される（http://localhost:3001）
- [ ] Temporal Web UIがアクセス可能（http://localhost:8233）

### エージェント提出フロー
- [ ] エージェント提出が202 Acceptedを返す
- [ ] Temporal Workflowが作成される（Temporal Web UIで確認）
- [ ] Review UIで提出物が表示される
- [ ] データベースに提出レコードが保存される
- [ ] APIで提出状態を取得できる（`GET /v1/submissions/{id}`）

### レビューパイプライン
- [ ] PreCheckステージが実行される
- [ ] Security Gateステージが実行される
- [ ] 各ステージのステータスがReview UIに反映される
- [ ] Temporal Web UIでワークフローの進行が確認できる
- [ ] エラーが発生した場合、ログに詳細が記録される

### 統合動作確認
- [ ] API → Temporal → Workerの連携が動作する
- [ ] Worker → PostgreSQLのデータ保存が動作する
- [ ] Review UI → APIのデータ取得が動作する
- [ ] すべてのコンテナが安定して動作する（再起動しない）

---

## 📝 追加情報

### PoCの制限事項

このPoCでは以下の機能が制限されています：

1. **認証・認可が未実装**
   - すべてのAPIエンドポイントが認証なしでアクセス可能
   - 本番環境ではJWT認証またはAPIキー認証が必須

2. **Functional Accuracyステージの制限**
   - 実際のエージェントコードの実行には、有効なtarballとSandbox Runnerが必要
   - テスト用のサンプルデータが不足している場合、このステージはスキップまたはエラーになる

3. **Human Reviewの手動操作**
   - Review UIからの承認/却下は実装されているが、通知機能は未実装

4. **スケーラビリティ**
   - 単一のWorkerインスタンスのみ
   - 本番環境では複数のWorkerインスタンスを使用してスケールアウトが可能

### 次のステップ

PoCが正常に動作することを確認したら、以下の機能追加を検討してください：

1. **セキュリティの強化**（優先度：高）
   - API認証・認可の実装（JWT/APIキー）
   - Rate limiting（既に実装済みだが、設定の調整）
   - HTTPS対応

2. **監視・ログ**（優先度：高）
   - Prometheus/Grafanaによるメトリクス収集
   - 構造化ログの導入（JSON形式）
   - アラート設定

3. **機能の拡張**（優先度：中）
   - WebSocketによるリアルタイム更新
   - Human Review通知機能（メール/Slack）
   - バッチ処理機能

4. **テストの追加**（優先度：中）
   - E2Eテストの自動化（Playwright）
   - 統合テストの拡充
   - パフォーマンステスト

詳細は `docs/POC_EVALUATION_REPORT.md` を参照してください。
