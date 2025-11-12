# Agent Store コードレビューレポート

**レビュー日時**: 2025-11-12
**レビュー対象**: Docker統合環境構築とソースコード全体
**レビュワー**: Claude Code (AI Assistant)

---

## エグゼクティブサマリー

Agent Storeは、AIエージェントの登録から審査、公開までを一気通貫で処理する研究用サンドボックスシステムです。本レビューでは、新規に追加されたDocker Compose統合環境と、既存のソースコード（API、Temporal Workflow、Sandbox Runner）を包括的に評価しました。

### 総合評価: B+ (良好、改善の余地あり)

**強み:**
- 明確なアーキテクチャと責任分離
- 暗号署名検証によるセキュリティ対策
- マイクロサービス指向の設計
- 包括的な審査パイプライン（Security Gate、Functional Accuracy、Judge Panel）

**改善が必要な領域:**
- セキュリティの強化（パスワードのハードコード、CORS設定、入力検証）
- エラーハンドリングの改善
- 本番環境向けの設定最適化
- ドキュメンテーションの充実

---

## 1. Docker環境のレビュー

### 1.1 docker-compose.yml

**ファイルパス**: [docker-compose.yml](/Users/naoya.yasuda/Geniac-Prize/agent-store/docker-compose.yml)

#### 良い点 ✅

1. **適切なサービス分離**
   - PostgreSQL、Temporal、API、Review UI、Temporal Workerが明確に分離
   - 各サービスが独立したコンテナとして定義

2. **ヘルスチェックの実装**
   ```yaml
   healthcheck:
     test: ["CMD-SHELL", "pg_isready -U agent_store_user -d agent_store"]
     interval: 5s
     timeout: 5s
     retries: 5
   ```
   - データベースとTemporalサーバのヘルスチェックを実装
   - `depends_on`で適切な起動順序を制御

3. **ネットワーク分離**
   - 専用ネットワーク (`agent-store-network`) で各サービスを接続
   - 外部からの不要なアクセスを制限

#### 問題点 ⚠️

1. **セキュリティ: パスワードのハードコード (重大)**
   ```yaml
   environment:
     POSTGRES_USER: agent_store_user
     POSTGRES_PASSWORD: agent_store_pass  # ⚠️ ハードコードされたパスワード
   ```

   **リスク**:
   - ソースコード管理にパスワードが含まれる
   - 本番環境で同じパスワードが使用される可能性

   **推奨対応**:
   ```yaml
   environment:
     POSTGRES_USER: ${POSTGRES_USER:-agent_store_user}
     POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
   ```

2. **ポート公開範囲が広すぎる**
   ```yaml
   ports:
     - "5432:5432"  # ⚠️ PostgreSQLをホストに公開
   ```

   **リスク**: 本番環境でデータベースが外部に公開される

   **推奨対応**:
   - 開発環境のみポート公開
   - 本番では内部ネットワーク経由のみアクセス許可
   ```yaml
   # 開発環境のみ
   # ports:
   #   - "5432:5432"
   ```

3. **Temporal Serverがsqliteを使用**
   ```yaml
   environment:
     - DB=sqlite  # ⚠️ 本番環境には不適切
   ```

   **リスク**:
   - 永続性が低い
   - スケーラビリティがない

   **推奨対応**: 本番ではPostgreSQLを使用
   ```yaml
   environment:
     - DB=postgresql
     - POSTGRES_SEEDS=postgres
   ```

4. **リソース制限の欠如**
   - CPU/メモリ制限が設定されていない
   - 1つのコンテナがリソースを独占する可能性

   **推奨対応**:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '1.0'
         memory: 1G
       reservations:
         cpus: '0.5'
         memory: 512M
   ```

5. **ログ管理の欠如**
   - ログローテーションの設定なし
   - ディスク容量を圧迫する可能性

   **推奨対応**:
   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "10m"
       max-file: "3"
   ```

### 1.2 Dockerfile (API)

**ファイルパス**: [docker/api/Dockerfile](/Users/naoya.yasuda/Geniac-Prize/agent-store/docker/api/Dockerfile)

#### 良い点 ✅

1. **軽量ベースイメージ使用**
   - `node:20-alpine` を使用してイメージサイズを削減

2. **明示的なワークディレクトリ設定**

#### 問題点 ⚠️

1. **マルチステージビルドの未使用**
   - ビルドツールが本番イメージに含まれる
   - イメージサイズが肥大化

   **推奨対応**:
   ```dockerfile
   FROM node:20-alpine AS builder
   WORKDIR /app
   COPY api/ ./api/
   RUN cd api && npm install && npm run build

   FROM node:20-alpine AS production
   WORKDIR /app
   COPY --from=builder /app/dist ./dist
   RUN npm install --production
   ```

2. **セキュリティ: rootユーザーで実行**
   - コンテナがroot権限で実行される

   **推奨対応**:
   ```dockerfile
   RUN addgroup -g 1001 -S nodejs && \
       adduser -S nodejs -u 1001
   USER nodejs
   ```

3. **CORS設定が緩すぎる (重大)**
   ```javascript
   res.header('Access-Control-Allow-Origin', '*');  // ⚠️ すべてのオリジンを許可
   ```

   **リスク**: CSRF攻撃のリスク

   **推奨対応**:
   ```javascript
   const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'];
   const origin = req.headers.origin;
   if (allowedOrigins.includes(origin)) {
     res.header('Access-Control-Allow-Origin', origin);
   }
   ```

4. **エラーハンドリングが不十分**
   ```javascript
   } catch (error) {
     console.error('Failed to load API routes:', error.message);
   }
   // ⚠️ エラーが発生してもサーバーは起動し続ける
   ```

   **推奨対応**: ルート読み込みに失敗したらプロセスを終了

5. **ヘルスチェックエンドポイントが簡易的**
   ```javascript
   app.get('/health', (req, res) => {
     res.json({ status: 'ok', timestamp: new Date().toISOString() });
   });
   ```

   **推奨対応**: データベース接続など依存サービスの状態も確認

### 1.3 Dockerfile (Temporal Worker)

**ファイルパス**: [docker/temporal-worker/Dockerfile](/Users/naoya.yasuda/Geniac-Prize/agent-store/docker/temporal-worker/Dockerfile)

#### 良い点 ✅

1. **TypeScriptのビルドプロセスを含む**
2. **Python仮想環境を使用**

#### 問題点 ⚠️

1. **イメージサイズが大きい**
   - `third_party` ディレクトリ全体をコピー
   - 不要なファイルが含まれる可能性

   **推奨対応**: `.dockerignore` で除外

2. **ビルド時間が長い**
   - 依存関係が変更されなくてもすべて再インストール

   **推奨対応**: レイヤーキャッシュを活用
   ```dockerfile
   COPY package*.json ./
   RUN npm install
   COPY . .
   RUN npm run build
   ```

3. **シェルコマンドで仮想環境をアクティベート**
   ```dockerfile
   CMD ["/bin/sh", "-c", ". /app/.venv/bin/activate && node dist/src/worker.js"]
   ```

   **推奨対応**: 直接Pythonパスを指定
   ```dockerfile
   ENV PATH="/app/.venv/bin:$PATH"
   CMD ["node", "dist/src/worker.js"]
   ```

### 1.4 Dockerfile (Review UI)

**ファイルパス**: [docker/review-ui/Dockerfile](/Users/naoya.yasuda/Geniac-Prize/agent-store/docker/review-ui/Dockerfile)

#### 良い点 ✅

1. **マルチステージビルドを採用**
   - `deps`, `builder`, `runner` の3段階
   - 本番イメージが最小限

2. **非rootユーザーで実行**
   ```dockerfile
   RUN addgroup --system --gid 1001 nodejs && \
       adduser --system --uid 1001 nextjs
   USER nextjs
   ```

3. **Next.js standaloneモードを使用**
   - 必要最小限のファイルのみ含む

#### 問題点 ⚠️

1. **Next.js standaloneモードの設定確認が必要**
   - `next.config.js` に `output: 'standalone'` の設定が必要
   ```javascript
   // next.config.js
   module.exports = {
     output: 'standalone',
   }
   ```

2. **環境変数の注入タイミング**
   - ビルド時に `NEXT_PUBLIC_*` 変数が必要

   **推奨対応**:
   ```dockerfile
   ARG NEXT_PUBLIC_API_URL
   ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
   RUN npm run build
   ```

---

## 2. API層のレビュー

### 2.1 Submission API

**ファイルパス**: [api/routes/submissions.ts](/Users/naoya.yasuda/Geniac-Prize/agent-store/api/routes/submissions.ts)

#### 良い点 ✅

1. **バリデーション実装**
   - ペイロードの検証を実施

2. **適切なHTTPステータスコード**
   - 202 Accepted for async processing

3. **エラーハンドリング**

#### 問題点 ⚠️

1. **レート制限の欠如 (重大)**
   - DoS攻撃に脆弱

   **推奨対応**:
   ```typescript
   import rateLimit from 'express-rate-limit';

   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15分
     max: 100 // 最大100リクエスト
   });

   router.post('/v1/submissions', limiter, async (req, res) => {
   ```

2. **リクエストサイズ制限の確認**
   - AgentCardのサイズ制限が必要

   **推奨対応**: `express.json({ limit: '10mb' })` の妥当性を検証

3. **監査ログの欠如**
   - 誰がいつエージェントを登録したか記録されていない

   **推奨対応**: すべての登録試行をログに記録

### 2.2 Signature Verification

**ファイルパス**: [api/utils/signatureVerifier.ts](/Users/naoya.yasuda/Geniac-Prize/agent-store/api/utils/signatureVerifier.ts)

#### 良い点 ✅

1. **暗号署名検証の実装**
   - RSA-SHA256, ECDSA-SHA256をサポート

2. **Canonical JSON**
   - `stableStringify` で一貫性のあるJSON表現

3. **ダイジェスト検証**
   - ペイロード改ざんを検知

#### 問題点 ⚠️

1. **タイミング攻撃への対策不足**
   ```typescript
   if (digest !== bundle.payloadDigest.toLowerCase()) {
   ```

   **推奨対応**: 定数時間比較を使用
   ```typescript
   import { timingSafeEqual } from 'crypto';

   const digestBuf = Buffer.from(digest, 'hex');
   const expectedBuf = Buffer.from(bundle.payloadDigest, 'hex');
   if (!timingSafeEqual(digestBuf, expectedBuf)) {
   ```

2. **公開鍵の検証**
   - 公開鍵のフォーマット検証が不十分

   **推奨対応**: 鍵のフォーマットと長さを検証

3. **アルゴリズム選択の制限**
   - 脆弱なアルゴリズムの使用を防ぐ明示的なホワイトリスト

### 2.3 Submission Service

**ファイルパス**: [api/services/submissionService.ts](/Users/naoya.yasuda/Geniac-Prize/agent-store/api/services/submissionService.ts)

#### 良い点 ✅

1. **AgentCardの永続化**
   - ファイルシステムに保存

2. **W&B統合**
   - デフォルト値の提供

#### 問題点 ⚠️

1. **ファイルパスのセキュリティ (重大)**
   ```typescript
   const dir = path.join(SANDBOX_ARTIFACTS_DIR, artifactKey);
   ```

   **リスク**: Path Traversal攻撃の可能性

   **推奨対応**:
   ```typescript
   import { normalize, isAbsolute } from 'path';

   const sanitized = normalize(artifactKey).replace(/^(\.\.(\/|\\|$))+/, '');
   const dir = path.join(SANDBOX_ARTIFACTS_DIR, sanitized);

   // ディレクトリがSANDBOX_ARTIFACTS_DIR配下にあるか確認
   if (!dir.startsWith(SANDBOX_ARTIFACTS_DIR)) {
     throw new Error('Invalid artifact key');
   }
   ```

2. **エラーハンドリングの改善**
   ```typescript
   } catch (err) {
     console.error('[submissionService] failed to start workflow', err);
   }
   // ⚠️ エラーを握りつぶしている
   ```

   **推奨対応**: エラーを記録し、適切にエスカレーション

3. **同時書き込みの競合**
   - 同じartifactKeyで複数リクエストが来た場合の排他制御がない

---

## 3. Temporal Workflowのレビュー

**ファイルパス**: [prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts](/Users/naoya.yasuda/Geniac-Prize/agent-store/prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts)

#### 良い点 ✅

1. **明確なステージ管理**
   - precheck → security → functional → judge → human → publish

2. **Signal/Queryパターン**
   - 外部からワークフロー状態を取得・制御可能

3. **リトライロジック**
   - ステージごとの再試行をサポート

#### 問題点 ⚠️

1. **タイムアウト設定**
   ```typescript
   const activities = proxyActivities<Activities>({
     taskQueue: TASK_QUEUE,
     startToCloseTimeout: '1 minute'  // ⚠️ すべてのアクティビティで1分
   });
   ```

   **リスク**: 長時間実行されるアクティビティ（Judge Panel）がタイムアウト

   **推奨対応**: アクティビティごとに適切なタイムアウトを設定

2. **エラー伝播の改善**
   - アクティビティのエラーが詳細にログされていない

3. **デッドロック対策**
   - `notifyHumanReview` の無限待機の可能性

---

## 4. Sandbox Runnerのレビュー

**ファイルパス**: [sandbox-runner/src/sandbox_runner/cli.py](/Users/naoya.yasuda/Geniac-Prize/agent-store/sandbox-runner/src/sandbox_runner/cli.py)

#### 良い点 ✅

1. **明確なCLIインターフェース**
   - argparseで豊富なオプション

2. **W&B統合**
   - オプトインでテレメトリを記録

3. **Dry-runモード**
   - 外部呼び出しなしでテスト可能

#### 問題点 ⚠️

1. **デフォルト値のハードコード**
   ```python
   parser.add_argument("--wandb-base-url", default="https://wandb.fake")
   ```

   **推奨対応**: 環境変数からデフォルト値を取得

2. **入力検証の不足**
   - `--security-attempts` に負の値が指定可能

   **推奨対応**:
   ```python
   parser.add_argument("--security-attempts", type=int, default=8,
                       help="Number of security prompts to run",
                       metavar="N",
                       type=lambda x: int(x) if int(x) > 0 else parser.error("Must be positive"))
   ```

3. **例外処理の改善**
   - JSONパースエラーの詳細が不明確

---

## 5. セキュリティリスク評価

### 5.1 高リスク (即座に対応が必要)

| リスク | 場所 | 影響 | 推奨対応 |
|--------|------|------|----------|
| パスワードのハードコード | docker-compose.yml | 認証情報の漏洩 | 環境変数化、Secrets管理 |
| CORS設定が緩すぎる | docker/api/Dockerfile | CSRF攻撃 | オリジンのホワイトリスト化 |
| Path Traversal脆弱性 | api/services/submissionService.ts | 任意ファイル読み書き | パス検証の強化 |
| レート制限の欠如 | api/routes/*.ts | DoS攻撃 | Rate limitingの実装 |

### 5.2 中リスク (計画的に対応)

| リスク | 場所 | 影響 | 推奨対応 |
|--------|------|------|----------|
| rootユーザーで実行 | docker/api/Dockerfile | コンテナ脱出時の影響拡大 | 非特権ユーザーの使用 |
| PostgreSQLポート公開 | docker-compose.yml | 不正アクセス | 内部ネットワークのみ |
| タイミング攻撃 | api/utils/signatureVerifier.ts | 情報漏洩 | 定数時間比較 |

### 5.3 低リスク (監視・改善)

| リスク | 場所 | 影響 | 推奨対応 |
|--------|------|------|----------|
| ログローテーション未設定 | docker-compose.yml | ディスク容量圧迫 | ログ管理の実装 |
| リソース制限なし | docker-compose.yml | リソース枯渇 | CPU/メモリ制限 |

---

## 6. パフォーマンスとスケーラビリティ

### 6.1 ボトルネック

1. **Temporal ServerのSQLite使用**
   - スケールアウト不可
   - **推奨**: PostgreSQLバックエンドへ移行

2. **ファイルシステムベースのArtifacts保存**
   - 複数ノードでの共有が困難
   - **推奨**: S3互換ストレージへ移行

3. **同期的なワークフロー開始**
   ```typescript
   await startReviewWorkflow({ ... });
   ```
   - API応答が遅くなる可能性
   - **推奨**: 既に202 Acceptedを返しているので問題なし

### 6.2 最適化の提案

1. **Dockerイメージのマルチアーキテクチャビルド**
   ```bash
   docker buildx build --platform linux/amd64,linux/arm64
   ```

2. **接続プーリングの確認**
   - PostgreSQLコネクションプールの設定

3. **CDNの活用**
   - Review UIの静的アセット配信

---

## 7. テスタビリティとメンテナンス性

### 7.1 良い点 ✅

1. **テストファイルの存在**
   - `tests/`, `__tests__/` ディレクトリ

2. **型安全性**
   - TypeScript使用

3. **明確なディレクトリ構造**

### 7.2 改善提案

1. **統合テストの追加**
   ```bash
   # docker-compose.test.yml
   version: '3.9'
   services:
     integration-tests:
       build: ./tests
       depends_on:
         - api
         - postgres
   ```

2. **CI/CDパイプライン**
   - GitHub Actionsでの自動テスト実行

3. **APIドキュメント**
   - OpenAPI/Swagger仕様の生成

---

## 8. 改善優先順位

### フェーズ1: セキュリティ修正 (即座)

1. パスワードをSecrets管理へ移行
2. CORS設定の厳格化
3. Path Traversal対策
4. レート制限の実装

### フェーズ2: 本番環境対応 (1-2週間)

1. Temporal ServerのPostgreSQL化
2. リソース制限の設定
3. ログローテーションの実装
4. 非rootユーザーでの実行

### フェーズ3: 機能強化 (1-2ヶ月)

1. 監査ログの実装
2. S3互換ストレージへの移行
3. マルチアーキテクチャビルド
4. 包括的な統合テスト

---

## 9. ベストプラクティス適合状況

| カテゴリ | 評価 | コメント |
|---------|------|----------|
| セキュリティ | C+ | 暗号署名は実装されているが、CORS、パスワード管理に課題 |
| パフォーマンス | B | 現状は問題ないが、スケールアウト時に課題 |
| 可用性 | B- | ヘルスチェックはあるが、リトライロジックが限定的 |
| 保守性 | A- | 明確な構造、型安全性、ドキュメント |
| テスタビリティ | B | テストは存在するが、統合テストが不足 |
| 監視性 | B- | W&B連携はあるが、APMツール連携がない |

---

## 10. 推奨アクションアイテム

### 開発チーム向け

- [ ] Secrets管理ツール（AWS Secrets Manager、Vault等）の導入
- [ ] CORS設定を環境変数で制御可能に
- [ ] Path検証ユーティリティ関数の作成
- [ ] Rate limitingミドルウェアの実装
- [ ] 統合テストスイートの作成

### DevOps/インフラチーム向け

- [ ] docker-compose.prod.ymlの作成
- [ ] Kubernetes manifestへの移行検討
- [ ] S3互換ストレージのセットアップ
- [ ] モニタリングスタック（Prometheus、Grafana）の構築

### セキュリティチーム向け

- [ ] 脆弱性スキャンの定期実行（Trivy、Snyk等）
- [ ] ペネトレーションテストの実施
- [ ] セキュリティ監査ログの設計

---

## 11. 結論

Agent Storeは、よく設計されたマイクロサービスアーキテクチャを持つ有望なシステムです。Docker Compose統合により、開発体験が大幅に向上しました。

**即座に対応すべき事項**:
1. パスワード管理の改善
2. CORS設定の厳格化
3. Path Traversal対策

**中長期的な改善**:
1. 本番環境向け設定の分離
2. スケーラビリティの向上
3. 監視とロギングの強化

本レビューで指摘した改善を段階的に実施することで、本番環境での安定運用が可能になります。

---

## 付録A: 関連ドキュメント

- [README.md](/Users/naoya.yasuda/Geniac-Prize/agent-store/README.md) - プロジェクト概要
- [DOCKER_QUICKSTART.md](/Users/naoya.yasuda/Geniac-Prize/agent-store/DOCKER_QUICKSTART.md) - Docker使用ガイド
- [AGENTS.md](/Users/naoya.yasuda/Geniac-Prize/agent-store/AGENTS.md) - コントリビュータガイド

## 付録B: レビュー対象ファイル一覧

### Docker関連
- `docker-compose.yml`
- `docker/api/Dockerfile`
- `docker/temporal-worker/Dockerfile`
- `docker/review-ui/Dockerfile`
- `.dockerignore`

### API層
- `api/routes/submissions.ts`
- `api/routes/agentCards.ts`
- `api/routes/reviews.ts`
- `api/services/submissionService.ts`
- `api/utils/signatureVerifier.ts`

### Temporal Workflow
- `prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts`
- `prototype/temporal-review-workflow/src/activities/index.ts`

### Sandbox Runner
- `sandbox-runner/src/sandbox_runner/cli.py`
- `sandbox-runner/src/sandbox_runner/security_gate.py`
- `sandbox-runner/src/sandbox_runner/functional_accuracy.py`

---

**レビューレポート終了**
