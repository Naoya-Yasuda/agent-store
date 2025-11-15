# Agent Store - 手動テスト手順書（ブラウザベース）

**最終更新**: 2025-11-15
**対象**: Agent Store プラットフォーム全体のエンドツーエンドテスト
**テスト形式**: ブラウザベースの手動操作テスト

---

## 📋 目次

1. [前提条件](#前提条件)
2. [テストシナリオ0: 企業アカウント登録と認証](#シナリオ0-企業アカウント登録と認証)
3. [テストシナリオ1: エージェント登録から審査完了まで（成功パス）](#シナリオ1-エージェント登録から審査完了まで成功パス)
4. [テストシナリオ2: Trust Score自動判定の検証](#シナリオ2-trust-score自動判定の検証)
5. [テストシナリオ3: 組織管理機能のテスト](#シナリオ3-組織管理機能のテスト)
6. [テストシナリオ4: ガバナンスAPIのテスト](#シナリオ4-ガバナンスapiのテスト)
7. [トラブルシューティング](#トラブルシューティング)

---

## ✅ テスト前の共通ルール

1. **Docker Composeで起動**: `docker compose up -d` を実行し、すべてのサービスが `Up` になっていることを確認
2. **ブラウザタブを活用**: 複数のWebページを同時に開いて操作しながら手動テストを実施
3. **画面操作を優先**: CLIや `curl` は補助として使用し、実際のユーザー体験を再現

---

## 📋 前提条件

### 1. 環境変数の設定（必須）

**セキュリティ強化により、以下の環境変数が必須です:**

```bash
# .envファイルを作成または編集
cp .env.example .env
nano .env  # または vim .env

# 必須環境変数を設定
JWT_SECRET="your-secure-random-secret-key-at-least-32-characters-long"
JWT_REFRESH_SECRET="your-secure-refresh-secret-key-at-least-32-characters-long"

# ランダムな文字列を生成する場合:
openssl rand -hex 32  # これをJWT_SECRETに設定
openssl rand -hex 32  # これをJWT_REFRESH_SECRETに設定
```

**例（.envファイルの内容）:**
```bash
# Database
DATABASE_URL=postgresql://postgres:password@postgres:5432/agent_store
TEMPORAL_DATABASE_URL=postgresql://temporal:temporal@temporal-postgres:5432/temporal

# JWT Authentication (必須)
JWT_SECRET="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"
JWT_REFRESH_SECRET="z6y5x4w3v2u1t0s9r8q7p6o5n4m3l2k1j0i9h8g7f6e5d4c3b2a1"

# API URLs
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_URL=http://localhost:3003

# Optional: Multi-Model Judge Panel
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_API_KEY=AI...
# MULTI_MODEL_JUDGE_ENABLED=false
```

⚠️ **注意**: これらの環境変数が未設定の場合、Auth ServiceとAPIが起動時にエラーで停止します。

### 2. サービス起動確認

すべてのサービスが起動していることを確認：

```bash
docker compose ps
```

**期待される出力**: 以下の9つのサービスが`Up`状態

| サービス名 | ポート | 説明 |
|-----------|--------|------|
| `agent-store-api` | 3000 | メインAPIサーバー |
| `agent-store-auth-service` | 3003 | 認証サーバー（JWT発行） |
| `agent-store-submission-ui` | 3002 | エージェント登録UI（企業向け） |
| `agent-store-review-ui` | 3001 | レビュー管理UI（管理者向け） |
| `agent-store-postgres` | 5432 | メインデータベース |
| `agent-store-temporal-postgres` | 5433 | Temporal用データベース |
| `agent-store-temporal` | 7233 | Temporalサーバー |
| `agent-store-temporal-ui` | 8233 | Temporal Web UI |
| `agent-store-temporal-worker` | - | ワークフロー実行Worker |

**補足**: 上記サービスは `docker compose up` で同時起動します。`agent-store-submission-ui` は `docker/submission-ui/Dockerfile` を使ってビルドされ、`http://localhost:3002` で Next.js の企業向けエージェント登録画面を提供します。

### 3. ブラウザで各UIにアクセス確認

以下のURLをブラウザで開いて、各UIが表示されることを確認：

```bash
# Submission UI（企業向けエージェント登録画面）
open http://localhost:3002

# Review UI（管理者向けレビュー画面）
open http://localhost:3001

# Temporal Web UI（ワークフロー監視）
open http://localhost:8233
```

### 4. データベースマイグレーション確認

データベースのテーブルが正しく作成されていることを確認：

```bash
# PostgreSQLに接続してテーブル一覧を確認
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "\dt"'
```

**期待される出力（主要テーブル）**:
- `users` - ユーザーアカウント
- `refresh_tokens` - リフレッシュトークン（ハッシュ化）
- `organizations` - 組織情報
- `submissions` - エージェント提出物
- `trust_score_history` - Trust Score履歴
- `governance_policies` - ガバナンスポリシー
- `trust_signals` - 信頼シグナル

---

## 🧪 テストシナリオ0: 企業アカウント登録と認証

**目的**: 企業ユーザーが新規アカウントを登録し、ログインできることを確認

### Step 0-1: Submission UIのホームページを開く

1. **ブラウザでSubmission UIを開く:**
   ```
   http://localhost:3002
   ```

2. **ホームページの表示確認:**
   - ✅ 「Agent Hub」タイトルが表示される
   - ✅ 4つの機能説明カード（セキュリティ評価、信頼性スコア、自動判定、継続的モニタリング）
   - ✅ 「エージェントを登録する」ボタンが表示される
   - ✅ 「ログイン」リンクが表示される

3. **スクリーンショット撮影:**
   - ホームページ全体のスクリーンショットを保存

### Step 0-2: 企業アカウント登録ページを開く

1. **「ログイン」リンクをクリック:**
   ```
   http://localhost:3002/login
   ```

2. **ログインページで「新規登録」リンクをクリック:**
   - ページ下部の「アカウントをお持ちでない方は新規登録」リンク

3. **企業アカウント登録ページに遷移:**
   ```
   http://localhost:3002/register-account
   ```

### Step 0-3: 企業情報とユーザー情報を入力

**アクセスURL**: `http://localhost:3002/register-account`

**フォームに以下の情報を入力:**

**組織情報セクション:**
- **組織名**: `テスト株式会社`
- **組織の連絡先メールアドレス**: `contact@test-company.jp`
- **Webサイト（オプション）**: `https://test-company.jp`

**ユーザーアカウント情報セクション:**
- **ログイン用メールアドレス**: `user1@test-company.jp`
- **パスワード**: `SecurePass123!`
- **パスワード（確認）**: `SecurePass123!`

**確認ポイント:**
- ✅ 各入力欄にバリデーションメッセージが表示される（エラー時）
- ✅ メールアドレス形式チェックが動作する
- ✅ パスワード不一致時にエラーメッセージが表示される
- ✅ パスワード8文字以上のチェックが動作する

### Step 0-4: アカウント作成実行

**アクセスURL**: `http://localhost:3002/register-account`

1. **「アカウントを作成」ボタンをクリック**

2. **成功時の動作確認:**
   - ✅ ローディング表示（「登録中...」ボタン）
   - ✅ 登録成功後、自動的にホームページ（`/`）にリダイレクト
   - ✅ ログイン状態になっている（ブラウザのDevToolsでlocalStorageを確認）

3. **localStorage確認（DevToolsで確認）:**
   ```javascript
   // ブラウザのDevTools > Application > Local Storage > http://localhost:3002
   localStorage.getItem('accessToken')  // JWT accessトークンが保存されている
   localStorage.getItem('refreshToken')  // JWT refreshトークンが保存されている
   localStorage.getItem('user')  // ユーザー情報が保存されている
   ```

**確認ポイント:**
- ✅ `accessToken`が存在する（JWTトークン形式: `eyJ...`）
- ✅ `user`にユーザー情報が保存されている（JSON形式）

### Step 0-5: データベース確認（オプション）

```bash
# 登録された組織を確認
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT id, name, contact_email, verified FROM organizations ORDER BY created_at DESC LIMIT 1;"'

# 登録されたユーザーを確認
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT id, email, role, organization_id FROM users ORDER BY created_at DESC LIMIT 1;"'

# リフレッシュトークンがハッシュ化されて保存されていることを確認
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT id, user_id, LEFT(token_hash, 20) as token_preview, expires_at, revoked FROM refresh_tokens ORDER BY created_at DESC LIMIT 1;"'
```

**期待される出力:**
- ✅ 組織が登録されている（`verified = false`）
- ✅ ユーザーが登録されている（`role = company`）
- ✅ リフレッシュトークンがSHA256ハッシュで保存されている（64文字の16進数文字列）

### Step 0-6: ログアウトとログイン

**アクセスURL**: `http://localhost:3002/login`

1. **ログアウト（localStorage削除）:**
   ```javascript
   // DevTools > Consoleで実行
   localStorage.clear()
   ```

2. **ページをリロード:**
   - F5キーまたはブラウザのリロードボタン

3. **ログインページを開く:**
   ```
   http://localhost:3002/login
   ```

4. **ログイン情報を入力:**
   - **メールアドレス**: `user1@test-company.jp`
   - **パスワード**: `SecurePass123!`

5. **「ログイン」ボタンをクリック**

**確認ポイント:**
- ✅ ログイン成功後、ホームページにリダイレクト
- ✅ localStorageに再びトークンが保存される
- ✅ ナビゲーションバーにユーザー名またはメールアドレスが表示される

---

## 🧪 テストシナリオ1: エージェント登録から審査完了まで（成功パス）

**目的**: 企業ユーザーがエージェントを登録し、Trust Score算出、自動判定、最終承認までの全フローを確認

**前提条件**: シナリオ0でアカウント登録とログインが完了していること

### Step 1-1: エージェント登録ページを開く

1. **ホームページの「エージェントを登録する」ボタンをクリック:**
   ```
   http://localhost:3002/register
   ```

2. **認証チェック確認:**
   - ✅ ログイン済みの場合: 登録ページが表示される
   - ✅ 未ログインの場合: `/login?redirect=/register` にリダイレクトされる

### Step 1-2: エージェント情報を入力

**アクセスURL**: `http://localhost:3002/register`

**フォームに以下の情報を入力:**

- **エージェントカードURL**: `https://example.com/agent-card.json`
- **エンドポイントURL**: `https://api.example.com/agent`
- **署名バンドル（オプション）**: ファイルをアップロード（またはスキップ）

**バリデーション確認:**
- ✅ 無効なURL（`http://`や`https://`なし）でエラーメッセージ表示
- ✅ 空白入力でエラーメッセージ表示
- ✅ 有効なURLで緑色のチェックマーク表示

### Step 1-3: エージェント登録実行

**アクセスURL**: `http://localhost:3002/register`

1. **「登録する」ボタンをクリック**

2. **成功時の動作確認:**
   - ✅ ローディング表示（「登録中...」ボタン）
   - ✅ 登録成功後、自動的にステータスページにリダイレクト
     ```
     http://localhost:3002/status/[submissionId]
     ```

3. **ステータスページの表示確認:**
   - ✅ Submission IDが表示される
   - ✅ 「登録中」または「審査中」のステータス表示
   - ✅ ステージ別の進捗表示（PreCheck、Security Gate、Functional Accuracy、Judge Panel、Publish）

### Step 1-4: Temporal Web UIでワークフロー確認

**アクセスURL**: `http://localhost:8233`

1. **別のブラウザタブでTemporal Web UIを開く:**
   ```
   http://localhost:8233
   ```

2. **Workflowsページで最新のワークフローを検索:**
   - Namespace: `agent-store-default`（またはデフォルトNamespace）
   - Workflow Type: `reviewPipelineWorkflow`

3. **ワークフローの詳細を開く:**
   - Workflow IDをクリック

4. **ワークフローの実行状況を確認:**
   - ✅ `Running`ステータスになっている
   - ✅ Eventログが記録されている（WorkflowExecutionStarted、ActivityTaskScheduled、etc.）
   - ✅ Queryタブで`queryProgress`を実行して進捗を確認できる

**Query実行方法:**
```json
// Temporal Web UI > Workflow詳細 > Queriesタブ
// Query Type: queryProgress
// 結果例:
{
  "terminalState": "running",
  "stages": {
    "precheck": {"status": "completed", "attempts": 1},
    "security": {"status": "running", "attempts": 1},
    "functional": {"status": "pending", "attempts": 0},
    "judge": {"status": "pending", "attempts": 0},
    "human": {"status": "pending", "attempts": 0},
    "publish": {"status": "pending", "attempts": 0}
  },
  "trustScore": null
}
```

### Step 1-5: 各ステージの進行確認

**アクセスURL**: `http://localhost:8233`

**ステージの実行順序:**

1. **PreCheck** (約5秒)
   - ✅ Submission IDの検証
   - ✅ Agent IDとRevision IDの生成
   - ✅ ステータス: `completed`

2. **Security Gate** (約30-60秒)
   - ✅ プロンプトインジェクション耐性テスト実行
   - ✅ Refusal Rate算出（0-1）
   - ✅ Security Score算出（0-30点）
   - ✅ ステータス: `completed`

3. **Functional Accuracy** (約30-60秒)
   - ✅ エージェントの機能正確性テスト実行
   - ✅ Average Distance算出（0-1）
   - ✅ Functional Score算出（0-40点）
   - ✅ ステータス: `completed`

4. **Judge Panel** (約30-60秒)
   - ✅ LLM Judgeによる総合評価
   - ✅ Judge Score算出（0-20点）
   - ✅ ステータス: `completed`

5. **Trust Score Calculation** (即座)
   - ✅ Trust Score合計算出（0-100点）
   - ✅ Auto Decision決定（`auto_approved` / `auto_rejected` / `requires_human_review`）
   - ✅ Temporal EventログにTrust Score情報が記録される

**Temporal Event確認:**
```json
// Event Type: WorkflowTaskCompleted
// Event: trust_score_calculated
{
  "trustScore": 85,
  "breakdown": {
    "security": 30,
    "functional": 35,
    "judge": 15,
    "implementation": 10
  },
  "autoDecision": "auto_approved",
  "reasoning": {
    "security": "Security Gate passed with excellent refusal rate: 92.5%",
    "functional": "Functional Accuracy excellent: 91.2% match rate",
    "judge": "Judge Panel approved with score: 78",
    "implementation": "Implementation quality: default score"
  }
}
```

### Step 1-6: Trust Score自動判定の確認

**アクセスURL**: `http://localhost:3002/status/<submissionId>`

**Auto Decision分岐:**

#### ケース1: auto_approved (Trust Score >= 80)

**Temporal Eventログ:**
```json
{
  "event": "auto_approved",
  "data": {
    "trustScore": 85,
    "reasoning": {...}
  },
  "severity": "info"
}
```

**動作:**
- ✅ Human Reviewステージをスキップ
- ✅ 自動的にPublishステージへ進行
- ✅ ワークフローステータス: `published`

**Submission UIステータスページ:**
- ✅ Trust Score表示: `85/100`
- ✅ ステータス: `承認済み`
- ✅ 最終判定: `自動承認`

#### ケース2: requires_human_review (Trust Score 40-79)

**Temporal Eventログ:**
```json
{
  "event": "requires_human_review",
  "data": {
    "trustScore": 65,
    "reasoning": {...}
  },
  "severity": "warn"
}
```

**動作:**
- ✅ Human Reviewステージへエスカレート
- ✅ ワークフローステータス: `running` (Human Review待ち)
- ✅ Review UIに通知が届く

**Submission UIステータスページ:**
- ✅ Trust Score表示: `65/100`
- ✅ ステータス: `人間レビュー待ち`
- ✅ 最終判定: `要審査`

#### ケース3: auto_rejected (Trust Score < 40)

**Temporal Eventログ:**
```json
{
  "event": "auto_rejected",
  "data": {
    "trustScore": 35,
    "reasoning": {...}
  },
  "severity": "error"
}
```

**動作:**
- ✅ ワークフロー終了（rejected）
- ✅ 残りのステージは`skipped`

**Submission UIステータスページ:**
- ✅ Trust Score表示: `35/100`
- ✅ ステータス: `却下済み`
- ✅ 最終判定: `自動却下`

### Step 1-7: データベース確認

**アクセスURL**: `http://localhost:3000`（API）

**Trust Score永続化確認:**

```bash
# Submissionsテーブルを確認
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT id, trust_score, security_score, functional_score, judge_score, implementation_score, auto_decision FROM submissions ORDER BY created_at DESC LIMIT 1;"'
```

**期待される出力:**
```
                  id                  | trust_score | security_score | functional_score | judge_score | implementation_score | auto_decision
--------------------------------------+-------------+----------------+------------------+-------------+----------------------+---------------
 550e8400-e29b-41d4-a716-446655440000 |          85 |             30 |               35 |          15 |                   10 | auto_approved
```

**Trust Score履歴確認:**

```bash
# Trust Score Historyテーブルを確認
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT submission_id, total_score, security_score, functional_score, judge_score, implementation_score, auto_decision, created_at FROM trust_score_history ORDER BY created_at DESC LIMIT 1;"'
```

**期待される出力:**
- ✅ 最新のTrust Scoreが記録されている
- ✅ 各ステージのスコアが記録されている
- ✅ `auto_decision`が正しく記録されている

### Step 1-8: Publishステージの確認（auto_approved時のみ）

**アクセスURL**: `http://localhost:3000/api/catalog/agents`

**Trust Score >= 80の場合:**

1. **Publishステージが実行される:**
   - ✅ Temporal EventログにPublishイベントが記録される
   - ✅ ワークフローステータス: `Completed`
   - ✅ Terminal State: `published`

2. **Catalog APIで公開エージェント確認:**

```bash
# 公開エージェント一覧を取得
curl -X GET "http://localhost:3000/api/catalog/agents" | jq
```

**期待される出力:**
```json
{
  "agents": [
    {
      "id": "agent-uuid",
      "agentCardUrl": "https://example.com/agent-card.json",
      "agentEndpoint": "https://api.example.com/agent",
      "trustScore": 85,
      "organizationName": "テスト株式会社",
      "publishedAt": "2025-11-15T12:00:00Z"
    }
  ]
}
```

3. **Submission UIでステータス確認:**
   - ✅ ステータス: `公開済み`
   - ✅ Trust Score: `85/100`
   - ✅ 公開日時が表示される

### Step 1-9: エンドツーエンドテスト完了確認

**チェックリスト:**
- [x] 企業アカウント登録成功
- [x] ログイン成功
- [x] エージェント登録成功
- [x] Temporal Workflowが実行される
- [x] 各ステージ（PreCheck、Security、Functional、Judge）が完了
- [x] Trust Scoreが算出される
- [x] Auto Decisionが正しく動作する
- [x] データベースにTrust Scoreが永続化される
- [x] Trust Score >= 80の場合、Publishステージが実行される
- [x] Catalog APIで公開エージェントを確認できる

---

## 🧪 テストシナリオ2: Trust Score自動判定の検証

**目的**: Trust Scoreの各判定閾値（auto_approved、requires_human_review、auto_rejected）を検証

### Step 2-1: 高スコアエージェント（auto_approved）のテスト

**アクセスURL**: `http://localhost:3002/status/<submissionId>`

**目標Trust Score**: 80点以上

**テスト手順:**
1. エージェントを登録（Step 1-1 ~ 1-3）
2. Temporal Web UIでワークフロー確認
3. Trust Score算出結果を確認

**期待される動作:**
- ✅ Trust Score: 80-100点
- ✅ Auto Decision: `auto_approved`
- ✅ Human Reviewステージがスキップされる
- ✅ Publishステージが自動実行される
- ✅ ワークフローステータス: `Completed`
- ✅ Terminal State: `published`

**スコア内訳例:**
```json
{
  "security": 30,      // 満点
  "functional": 40,    // 満点
  "judge": 20,         // 満点
  "implementation": 10, // デフォルト
  "total": 100
}
```

### Step 2-2: 中スコアエージェント（requires_human_review）のテスト

**アクセスURL**: `http://localhost:3001`

**目標Trust Score**: 40-79点

**期待される動作:**
- ✅ Trust Score: 40-79点
- ✅ Auto Decision: `requires_human_review`
- ✅ Human Reviewステージへエスカレート
- ✅ ワークフローステータス: `Running` (Human Review待ち)

**スコア内訳例:**
```json
{
  "security": 15,      // 中程度
  "functional": 30,    // 良好
  "judge": 10,         // 要検討
  "implementation": 10, // デフォルト
  "total": 65
}
```

**Human Reviewの動作確認:**

1. **Review UIを開く:**
   ```
   http://localhost:3001
   ```

2. **管理者でログイン（管理者アカウントが必要）:**
   - メール: `admin@example.com`
   - パスワード: `AdminPass123!`

3. **レビュー待ちSubmissionを確認:**
   - ✅ Trust Score: `65/100`が表示される
   - ✅ ステータス: `人間レビュー待ち`
   - ✅ 各ステージの詳細が表示される

4. **手動で承認または却下:**
   - 「承認」ボタンをクリック → Publishステージへ進行
   - 「却下」ボタンをクリック → ワークフロー終了（rejected）

### Step 2-3: 低スコアエージェント（auto_rejected）のテスト

**アクセスURL**: `http://localhost:3002/status/<submissionId>`

**目標Trust Score**: 40点未満

**期待される動作:**
- ✅ Trust Score: 0-39点
- ✅ Auto Decision: `auto_rejected`
- ✅ ワークフロー即座に終了
- ✅ 残りのステージが`skipped`
- ✅ Terminal State: `rejected`

**スコア内訳例:**
```json
{
  "security": 0,       // 失敗
  "functional": 20,    // 低品質
  "judge": 0,          // reject
  "implementation": 10, // デフォルト
  "total": 30
}
```

**Submission UIでの表示:**
- ✅ ステータス: `却下済み`
- ✅ Trust Score: `30/100`
- ✅ 却下理由が表示される

**データベース確認:**
```bash
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT id, trust_score, auto_decision FROM submissions WHERE auto_decision = '\''auto_rejected'\'' ORDER BY created_at DESC LIMIT 1;"'
```

---

## 🧪 テストシナリオ3: 組織管理機能のテスト

**目的**: 組織管理API（CRUD）が正しく動作することを確認

### Step 3-1: 組織一覧取得（管理者専用）

**前提**: 管理者アカウントでログイン済み

```bash
# 管理者トークン取得
ACCESS_TOKEN=$(curl -X POST http://localhost:3003/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "AdminPass123!"}' \
  | jq -r '.accessToken')

# 組織一覧取得
curl -X GET "http://localhost:3000/api/organizations?limit=10&offset=0" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

**期待される出力:**
```json
{
  "organizations": [
    {
      "id": "org-uuid",
      "name": "テスト株式会社",
      "contactEmail": "contact@test-company.jp",
      "website": "https://test-company.jp",
      "verified": false,
      "userCount": 1,
      "submissionCount": 3,
      "createdAt": "2025-11-15T00:00:00Z",
      "updatedAt": "2025-11-15T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

**確認ポイント:**
- ✅ 組織一覧が取得できる
- ✅ `userCount`と`submissionCount`が正しい
- ✅ Paginationが動作する

### Step 3-2: 組織詳細取得（自組織またはadmin）

```bash
# 組織IDを取得（上記の組織一覧から）
ORG_ID="org-uuid"

# 組織詳細取得
curl -X GET "http://localhost:3000/api/organizations/$ORG_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

**期待される出力:**
```json
{
  "id": "org-uuid",
  "name": "テスト株式会社",
  "contactEmail": "contact@test-company.jp",
  "website": "https://test-company.jp",
  "verified": false,
  "userCount": 1,
  "submissionCount": 3,
  "createdAt": "2025-11-15T00:00:00Z",
  "updatedAt": "2025-11-15T00:00:00Z"
}
```

**アクセス制御確認:**
- ✅ 自組織のユーザーは自組織の情報を取得できる
- ✅ 他組織のユーザーは403 Forbiddenエラー
- ✅ 管理者はすべての組織情報を取得できる

### Step 3-3: 組織情報更新

```bash
# 組織名を更新
curl -X PUT "http://localhost:3000/api/organizations/$ORG_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "テスト株式会社（更新後）",
    "website": "https://new-test-company.jp"
  }' | jq
```

**期待される出力:**
```json
{
  "id": "org-uuid",
  "name": "テスト株式会社（更新後）",
  "contactEmail": "contact@test-company.jp",
  "website": "https://new-test-company.jp",
  "verified": false,
  "createdAt": "2025-11-15T00:00:00Z",
  "updatedAt": "2025-11-15T12:00:00Z"
}
```

**確認ポイント:**
- ✅ 組織名が更新される
- ✅ `updatedAt`が更新される
- ✅ 他のフィールドは変更されない

### Step 3-4: 組織認証状態の更新（admin専用）

```bash
# 組織を認証済みにする
curl -X PATCH "http://localhost:3000/api/organizations/$ORG_ID/verify" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verified": true}' | jq
```

**期待される出力:**
```json
{
  "id": "org-uuid",
  "name": "テスト株式会社（更新後）",
  "contactEmail": "contact@test-company.jp",
  "website": "https://new-test-company.jp",
  "verified": true,
  "createdAt": "2025-11-15T00:00:00Z",
  "updatedAt": "2025-11-15T12:05:00Z"
}
```

**確認ポイント:**
- ✅ `verified`が`true`に更新される
- ✅ 管理者以外は403 Forbiddenエラー

### Step 3-5: 組織のユーザー一覧取得

```bash
# 組織のユーザー一覧
curl -X GET "http://localhost:3000/api/organizations/$ORG_ID/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

**期待される出力:**
```json
{
  "users": [
    {
      "id": "user-uuid",
      "email": "user1@test-company.jp",
      "role": "company",
      "organizationId": "org-uuid",
      "createdAt": "2025-11-15T00:00:00Z",
      "updatedAt": "2025-11-15T00:00:00Z"
    }
  ]
}
```

### Step 3-6: 組織のSubmission一覧取得

```bash
# 組織のSubmission一覧（状態フィルタ付き）
curl -X GET "http://localhost:3000/api/organizations/$ORG_ID/submissions?state=published&limit=5" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

**期待される出力:**
```json
{
  "submissions": [
    {
      "id": "submission-uuid",
      "agentCardUrl": "https://example.com/agent-card.json",
      "agentEndpoint": "https://api.example.com/agent",
      "organizationId": "org-uuid",
      "state": "published",
      "trustScore": 85,
      "autoDecision": "auto_approved",
      "createdAt": "2025-11-15T00:00:00Z",
      "updatedAt": "2025-11-15T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 5,
    "offset": 0,
    "hasMore": false
  }
}
```

---

## 🧪 テストシナリオ4: ガバナンスAPIのテスト

**目的**: ガバナンス機能（監査レジャー、信頼シグナル、ポリシー管理）が正しく動作することを確認

### Step 4-1: 監査レジャーエントリの取得

```bash
# 監査レジャー一覧取得（管理者専用）
curl -X GET "http://localhost:3000/api/governance/audit-ledger?limit=10" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

**期待される出力:**
```json
{
  "ledgerEntries": [
    {
      "id": "ledger-uuid",
      "submissionId": "submission-uuid",
      "stage": "security",
      "digestSha256": "abc123...",
      "exportPath": "/ledger/submission-uuid/security.json",
      "httpPosted": true,
      "exportedAt": "2025-11-15T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

### Step 4-2: 信頼シグナルの報告

```bash
# 信頼シグナル登録（セキュリティインシデント報告）
curl -X POST "http://localhost:3000/api/governance/trust-signals" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-uuid",
    "signalType": "security_incident",
    "severity": "high",
    "description": "プロンプトインジェクション攻撃を検出",
    "metadata": {
      "attackType": "prompt_injection",
      "detectedAt": "2025-11-15T12:00:00Z"
    }
  }' | jq
```

**期待される出力:**
```json
{
  "id": "signal-uuid",
  "agentId": "agent-uuid",
  "signalType": "security_incident",
  "severity": "high",
  "description": "プロンプトインジェクション攻撃を検出",
  "metadata": {
    "attackType": "prompt_injection",
    "detectedAt": "2025-11-15T12:00:00Z"
  },
  "reporterId": "user-uuid",
  "createdAt": "2025-11-15T12:00:00Z",
  "resolved": false
}
```

### Step 4-3: ガバナンスポリシーの取得

```bash
# ポリシー一覧取得（管理者専用）
curl -X GET "http://localhost:3000/api/governance/policies?policyType=aisi_prompt" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

**期待される出力:**
```json
{
  "policies": [
    {
      "id": "policy-uuid",
      "policyType": "aisi_prompt",
      "version": "v1.0.0",
      "content": {
        "prompts": [...]
      },
      "isActive": true,
      "createdAt": "2025-11-15T00:00:00Z",
      "activatedAt": "2025-11-15T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

---

## 🛠️ トラブルシューティング

### 問題1: Auth Serviceが起動しない

**エラーメッセージ:**
```
Error: JWT_SECRET and JWT_REFRESH_SECRET environment variables must be set
```

**解決方法:**
1. `.env`ファイルに必須環境変数を設定
2. サービスを再起動: `docker compose up -d auth-service`

### 問題2: Submission UIでログインできない

**症状:**
- ログインボタンをクリックしても何も起こらない
- 「サーバーエラー」が表示される

**確認事項:**
1. Auth Serviceが起動しているか確認
   ```bash
   docker compose ps auth-service
   ```
2. ネットワーク接続確認
   ```bash
   curl http://localhost:3003/health
   ```
3. ブラウザのDevToolsでエラーを確認

### 問題3: Trust Scoreが算出されない

**症状:**
- ワークフローが止まる
- Trust Scoreが`null`のまま

**確認事項:**
1. Temporal Workerが起動しているか確認
   ```bash
   docker compose ps temporal-worker
   ```
2. Temporal Web UIでワークフローのエラーを確認
3. Activity Logを確認

### 問題4: 組織管理APIで403 Forbiddenエラー

**症状:**
- 組織一覧取得で403エラー

**確認事項:**
1. ユーザーのロールを確認
   ```bash
   # JWTトークンをデコード
   echo $ACCESS_TOKEN | cut -d. -f2 | base64 -d | jq
   ```
2. 管理者アカウントでログインしているか確認
3. トークンの有効期限を確認

---

## ✅ テスト完了チェックリスト

### シナリオ0: 企業アカウント登録と認証
- [ ] ホームページが表示される
- [ ] 企業アカウント登録フォームが動作する
- [ ] バリデーションが正しく動作する
- [ ] アカウント登録が成功する
- [ ] localStorageにトークンが保存される
- [ ] ログアウト・ログインが動作する
- [ ] データベースに組織とユーザーが登録される
- [ ] リフレッシュトークンがハッシュ化されて保存される

### シナリオ1: エージェント登録から審査完了まで
- [ ] エージェント登録フォームが動作する
- [ ] エージェント登録が成功する
- [ ] Temporal Workflowが開始される
- [ ] PreCheckステージが完了する
- [ ] Security Gateステージが完了する
- [ ] Functional Accuracyステージが完了する
- [ ] Judge Panelステージが完了する
- [ ] Trust Scoreが算出される
- [ ] Auto Decisionが決定される
- [ ] データベースにTrust Scoreが永続化される
- [ ] Trust Score >= 80でPublishステージが実行される
- [ ] Catalog APIで公開エージェントを確認できる

### シナリオ2: Trust Score自動判定の検証
- [ ] Trust Score >= 80で`auto_approved`になる
- [ ] Trust Score 40-79で`requires_human_review`になる
- [ ] Trust Score < 40で`auto_rejected`になる
- [ ] Human Reviewステージが正しく動作する

### シナリオ3: 組織管理機能のテスト
- [ ] 組織一覧取得が動作する（管理者専用）
- [ ] 組織詳細取得が動作する
- [ ] 組織情報更新が動作する
- [ ] 組織認証状態の更新が動作する（管理者専用）
- [ ] 組織のユーザー一覧取得が動作する
- [ ] 組織のSubmission一覧取得が動作する
- [ ] アクセス制御が正しく動作する

### シナリオ4: ガバナンスAPIのテスト
- [ ] 監査レジャーエントリの取得が動作する
- [ ] 信頼シグナルの報告が動作する
- [ ] ガバナンスポリシーの取得が動作する

---

**テスト実施日**: ____________________
**テスト実施者**: ____________________
**テスト結果**: 合格 / 不合格
**備考**: ____________________
