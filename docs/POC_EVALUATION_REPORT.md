# Agent Store PoC評価レポート

**評価日**: 2025-11-13
**評価者**: Technical Review (Claude Code + Gemini MCP)
**プロジェクトバージョン**: commit 8ecba86時点

---

## 総合判定

**PoCレベルとして「十分」（条件付き）**

Agent Storeプロジェクトは、提出→審査→公開の一気通貫フローが実装されており、セキュリティ検証、機能正確性検証、人手レビューといった核心的なコンポーネントが揃っています。技術的な設計も堅牢で、SQLインジェクション対策、パストラバーサル対策、エラーハンドリングなど、基本的なセキュリティ要件を満たしています。

ただし、**API認証・認可が未実装**であり、これを解決しない限り、外部公開やステークホルダーへのデモンストレーションには適しません。

---

## 絶対に必要だが未実装の機能

### 🚨 致命的: API認証・認可の欠落

**現状の問題点:**
- すべてのAPIエンドポイントが無認証でアクセス可能
- 誰でも `POST /api/v1/submissions` でエージェントを提出できる
- 誰でも `/api/review/*` で他の提出物の審査情報を閲覧・ダウンロードできる

**影響:**
- **情報漏洩リスク**: 競合他社や悪意あるアクターが審査中のエージェントの詳細情報や脆弱性レポートを取得できる
- **データ改ざんリスク**: 承認/差戻しAPIが保護されていない場合、第三者が審査結果を改変できる可能性
- **DoS攻撃リスク**: レートリミットがIPベースのみのため、分散攻撃やプロキシを通じた大量リクエストに対して脆弱

**必要な実装:**

1. **認証層の追加**
   - JWT（JSON Web Token）またはAPIキー認証を全エンドポイントに導入
   - 実装ファイル: `api/middleware/auth.ts`（新規作成）
   - 適用対象: `api/server.ts` で全ルートに認証ミドルウェアを適用
   ```typescript
   // 例: JWT認証ミドルウェア
   app.use('/api', authenticateJWT);
   app.use('/api/review/*', requireRole('reviewer'));
   ```

2. **認可層の追加**
   - 提出者本人のみが自分の提出物の詳細を閲覧できる
   - レビュワー権限を持つユーザーのみが `/api/review/*` にアクセスできる
   - Human Review UIの承認/差戻しボタンは権限チェックを伴う
   - 実装ファイル: `api/middleware/authorization.ts`（新規作成）

3. **ユーザーベースのレートリミット**
   - 認証後のユーザーIDごとにリクエスト数を制限
   - 実装ファイル: `api/server.ts` の `rateLimit` 設定を拡張
   ```typescript
   const userRateLimit = rateLimit({
     windowMs: 60000,
     max: 50, // ユーザーごとに1分間50リクエスト
     keyGenerator: (req) => req.user?.id || req.ip
   });
   ```

4. **データベーススキーマの拡張**
   - ユーザーテーブルとロールテーブルの追加
   - 新規マイグレーション: `db/migrations/20251113_users_and_roles.sql`
   ```sql
   CREATE TABLE users (
       id UUID PRIMARY KEY,
       email TEXT UNIQUE NOT NULL,
       password_hash TEXT NOT NULL,
       role TEXT NOT NULL CHECK (role IN ('submitter', 'reviewer', 'admin')),
       created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
   );

   ALTER TABLE submissions ADD COLUMN submitter_id UUID REFERENCES users(id);
   ```

**実装の優先度**: 🔴 **最優先（外部公開前に必須）**

**推定工数**: 2-3日（認証基盤 + テスト + ドキュメント更新）

---

## 改善推奨事項（優先度順）

### 1. 🔴 API認証・認可の実装（最優先）

上記「絶対に必要だが未実装の機能」を参照してください。

---

### 2. 🟡 Temporal Workerの障害回復テストの追加（中優先）

**現状:**
- Temporalワークフローが実装されているが、ワーカーの異常終了やリトライの挙動が不明確
- Activity のタイムアウト・リトライポリシーが明示的に設定されていない

**推奨実装:**

1. **Activityのリトライポリシー設定**
   - ファイル: `prototype/temporal-review-workflow/src/activities.ts`
   ```typescript
   export const runSecurityGateActivity = async (input: SecurityGateInput) => {
     // 既存の実装
   };

   // Activity定義にリトライポリシーを追加
   export const securityGateOptions: ActivityOptions = {
     startToCloseTimeout: '30m',
     retryPolicy: {
       initialInterval: '10s',
       backoffCoefficient: 2.0,
       maximumAttempts: 3,
       maximumInterval: '5m',
       nonRetryableErrorTypes: ['ValidationError']
     }
   };
   ```

2. **E2Eテストの追加**
   - ファイル: `prototype/temporal-review-workflow/src/__tests__/workflow-resilience.test.ts`（新規作成）
   - テストシナリオ:
     - Sandbox Runner が一時的に失敗した場合のリトライ
     - PostgreSQL接続が切断された場合の再接続
     - W&B APIがタイムアウトした場合のフォールバック

3. **ドキュメント更新**
   - ファイル: `docs/design/temporal-poc-plan.md`
   - 障害回復シナリオとリトライポリシーを明記

**推定工数**: 1-2日

---

### 3. 🟡 Judge Panel の Manual 判定フローの完成（中優先）

**現状:**
- README.md:219 に「部分実装」と記載
- Inspect Worker CLIは動作するが、UI側のワークフローが未完成
- Playwrightテスト（`review-ui/tests/e2e/judge-manual.spec.ts`）で検証されている範囲を本番UIに統合する必要がある

**推奨実装:**

1. **Human Review UIの仕上げ**
   - ファイル: `review-ui/app/review/[submissionId]/page.tsx`
   - W&B Runのスクリーンショット/Artifactsプレビューをカードに埋め込む
   - 承認フォームにスクリーンショットを貼り付ける機能を追加

2. **Judge再実行ワークフローの完全統合**
   - ファイル: `api/routes/reviews.ts`
   - `/api/review/rerun-judge` エンドポイントのLLM override機能を完全実装
   - Temporal ワークフロー側の `runJudgePanel` Activity でパラメータを受け取る

3. **Playwrightシナリオの拡張**
   - ファイル: `review-ui/tests/e2e/judge-manual.spec.ts`
   - Manual判定→LLM override→Human承認の一連フローを1本のシナリオで検証

**関連ドキュメント:**
- `docs/design/judge-panel-human-review-implementation-20251110.md`

**推定工数**: 2-3日

---

### 4. 🟢 環境変数の検証と起動時チェック（低優先）

**現状:**
- `.env.example` に設定例があるが、必須環境変数が欠落した場合のエラーメッセージが不親切
- サービスが起動後にクラッシュする可能性がある

**推奨実装:**

1. **起動時チェックの追加**
   - ファイル: `api/server.ts`
   ```typescript
   const requiredEnvVars = [
     'DATABASE_URL',
     'TEMPORAL_ADDRESS',
     'POSTGRES_USER',
     'POSTGRES_PASSWORD'
   ];

   for (const varName of requiredEnvVars) {
     if (!process.env[varName]) {
       console.error(`ERROR: Required environment variable ${varName} is not set.`);
       console.error('Please check .env file. See .env.example for reference.');
       process.exit(1);
     }
   }
   ```

2. **Docker Compose healthcheckの強化**
   - ファイル: `docker-compose.yml`
   - APIコンテナの `healthcheck` に環境変数チェックを追加

**推定工数**: 0.5日

---

### 5. 🟢 W&B連携のフォールバック動作の明文化（低優先）

**現状:**
- `WANDB_DISABLED=true` で無効化できるが、W&B APIが到達不能な場合の動作が不明確
- ワークフロー全体が失敗するのか、ログに降格するのかが不明

**推奨実装:**

1. **フォールバック処理の実装**
   - ファイル: `sandbox-runner/src/sandbox_runner/wandb_mcp.py`
   ```python
   def log_to_wandb_safe(data: dict) -> bool:
       """W&B APIにログを送信。失敗時はローカルファイルに降格"""
       try:
           if WANDB_DISABLED:
               return False
           wandb.log(data)
           return True
       except Exception as e:
           logger.warning(f"W&B logging failed: {e}. Falling back to local log.")
           with open("logs/wandb_fallback.jsonl", "a") as f:
               json.dump(data, f)
               f.write("\n")
           return False
   ```

2. **ドキュメント更新**
   - ファイル: `README.md` の「W&B MCP 連携」セクション
   - W&B障害時の動作を明記:
     > W&B APIが到達不能な場合、ログは `logs/wandb_fallback.jsonl` に書き出され、ワークフロー自体は継続します。Human Review UIでは「W&B連携: オフライン」と表示されます。

**推定工数**: 0.5日

---

### 6. 🟢 入力バリデーションの網羅性向上（低優先）

**現状:**
- `api/utils/submissionValidator.ts` で提出ペイロードの検証が行われているが、他のAPI（特に `POST /review/*` 系）の入力値についても、より厳密な型チェックや値の範囲チェックを行うべき

**推奨実装:**

1. **Zodによるスキーマ定義**
   - ファイル: `api/schemas/reviewSchemas.ts`（新規作成）
   ```typescript
   import { z } from 'zod';

   export const RerunJudgeSchema = z.object({
     submissionId: z.string().uuid(),
     llmOverride: z.object({
       model: z.string().min(1),
       provider: z.enum(['openai', 'anthropic', 'google']),
       temperature: z.number().min(0).max(2),
       maxOutputTokens: z.number().int().positive(),
       dryRun: z.boolean().optional()
     }).optional()
   });
   ```

2. **バリデーションミドルウェアの適用**
   - ファイル: `api/routes/reviews.ts`
   ```typescript
   import { validate } from '../middleware/validation';

   router.post('/api/review/rerun-judge',
     validate(RerunJudgeSchema),
     async (req, res) => {
       // 検証済みのデータを使用
     }
   );
   ```

**推定工数**: 1日

---

## PoCとしての強み

1. **包括的なドキュメント**
   - README.md（241行）、設計ドキュメント（22ファイル）、AGENTS.md（コントリビュータガイド）が充実
   - Mermaid図でフロー全体を可視化

2. **自動テスト**
   - GitHub Actions で Docker Compose Smoke Test、Inspect Worker Tests、Review UI Playwright などを自動実行
   - CI/CDパイプラインが整備されている

3. **可観測性**
   - W&B MCPとの深い統合により、審査プロセス全体をトレース可能
   - Ledger（監査ログ）による改ざん検知機能

4. **セキュリティ意識**
   - パストラバーサル対策（`sanitizeSegment` + `ensureWithinRepo`）
   - SQLインジェクション対策（パラメータ化クエリ）
   - XSS対策（`escapeHtml`）
   - Embedding距離による異常検知

5. **スケーラビリティ**
   - Temporalによる分散ワークフロー
   - Docker Composeによるマイクロサービス構成
   - ステートレスなワーカー設計

---

## 技術スタック評価

| コンポーネント | 技術 | 評価 | 備考 |
|---|---|---|---|
| API | Express (Node.js) | ✅ 適切 | TypeScript化されており、型安全性が高い |
| ワークフローエンジン | Temporal | ✅ 適切 | 長時間実行プロセスに最適 |
| 審査ツール | Python 3.13 | ✅ 適切 | Google ADK/AISI Inspectとの親和性が高い |
| UI | Next.js | ✅ 適切 | Server-Side Renderingで高速 |
| データベース | PostgreSQL | ✅ 適切 | JSONB型でAgentCardを柔軟に格納 |
| 可観測性 | W&B MCP | ✅ 適切 | ML/AIプロジェクトの標準ツール |
| テスト | pytest, Vitest, Playwright | ✅ 適切 | 各レイヤーで適切なテストツールを選択 |

---

## 結論

**API認証・認可を実装すれば、PoCとして「完全に十分」**と評価できます。

現状の実装は研究室内やローカル検証には使用できますが、外部公開やステークホルダーへのデモには**認証実装が必須**です。その他の改善推奨事項は、本番運用を見据えた場合の「次のステップ」であり、PoCとしての価値を損なうものではありません。

---

## 次のアクションアイテム

1. **即座に対応（外部公開前に必須）**
   - [ ] API認証・認可の実装（優先度: 🔴）
   - [ ] 認証テストの追加（E2E + ユニットテスト）
   - [ ] ドキュメント更新（README.md + API仕様書）

2. **短期（1-2週間以内）**
   - [ ] Temporal Workerの障害回復テスト（優先度: 🟡）
   - [ ] Judge Panel の Manual 判定フロー完成（優先度: 🟡）

3. **中期（1ヶ月以内）**
   - [ ] 環境変数の検証と起動時チェック（優先度: 🟢）
   - [ ] W&B連携のフォールバック動作の明文化（優先度: 🟢）
   - [ ] 入力バリデーションの網羅性向上（優先度: 🟢）

---

## 参考資料

- [README.md](../README.md) - プロジェクト全体概要
- [AGENTS.md](../AGENTS.md) - コントリビュータガイド
- [docs/design/](./design/) - 設計ドキュメント集
- [.github/workflows/](./.github/workflows/) - CI/CD設定
