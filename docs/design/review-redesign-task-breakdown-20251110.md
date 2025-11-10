# Review Redesign Task Breakdown (2025-11-10)

## 0. 前提
- 参照: `docs/design/agent-store-review-redesign-20251108.md`, `docs/design/submission-review-flow-update-20251110.md`。
- 目的: Submission API / Sandbox Runner / Judge Orchestrator / UI の実装タスクを開発チーム単位で切り出す。
- 用語: Temporal (分散ワークフローエンジン)、A2A Relay (Agent-to-Agent中継層)、AdvBench (攻撃プロンプトの評価データセット)。

## 1. API チーム (`api/`)
1. **Submission API 新設**
   - ルート: `POST /v1/submissions`、`GET /v1/submissions/{id}`。
   - 入力DTO: AgentCard, endpointManifest, signatureBundle, organizationMeta。
   - バリデーション: `ajv` で `schemas/agent-card.schema.json` を検証し、署名チェーンは`@noble/ed25519`等で実装。
   - ユニットテスト: `api/tests/submission.test.ts` を追加し、正常/異常(署名不一致・schema invalid)を網羅。
2. **Endpoint Snapshot 永続化**
   - `db/migrations/20251110_add_endpoint_snapshot.sql` (仮) で `agent_endpoint_snapshots` テーブル追加。
   - Repository実装でSnapshotハッシュとA2A Relay IDを保存。
3. **Catalog API制限表示**
   - 審査中のカードは `displayName`, `shortDescription`, `status` のみ返却。
   - `statusReason` をレビュワー専用API (RBAC付き) に限定。
4. **Governance Hub連携**
   - Submission完了後 `governance-hub` にイベントを送信するWebhookクライアントを追加。

## 2. Sandbox Runner チーム (`sandbox-runner/`)
1. **AdvBench拡張テンプレ**
   - `sandbox_runner/templates/advbench/*.json` をカード固有語彙でリライトする前処理を追加。
   - 異常系成功時に`artifacts/pi_failures/`へJSONログ出力。
2. **シナリオDSLエンジン**
   - `sandbox_runner/scenarios/dsl.py` (新規) で AgentCard `useCases` から正常系スクリプトを生成。
   - ゴールドアンサー(RAGTruth)を `sandbox_runner/resources/ragtruth/*.jsonl` として保持。
3. **Embedding距離ユーティリティ**
   - `sandbox_runner/metrics/embedding.py` にエンコーダ呼び出しを実装し、距離<閾値時にHuman Reviewフラグを返す。
4. **pytest追加**
   - `tests/test_cli.py` にPositive/Negativeケース (成功/AdvBench失敗) を追加。

## 3. Judge / Inspect チーム (`prototype/inspect-worker/`, `prompts/aisi/`)
1. **Question Generator強化**
   - 観点カタログ管理ファイル `prompts/aisi/perspectives.yaml` を拡張し、AISI/AIR-Bench/MLCommons/TrustLLMのマッピングを追加。
   - AgentCard差異チェック(NLI: 自然言語推論モデル)を組み込み、質問リライト条件を定義。
2. **MCTS-Judge実装**
   - `prototype/inspect-worker/src/orchestrator/mctsJudge.ts` (新規) で検証→反証→再評価→集約→メタチェックの5ステップを記述。
   - Panel Judge (複数LLM) と Meta Judge (埋め込み統計) のインターフェースを分離。
3. **Human Review連携**
   - しきい値/矛盾検出時にTemporal Signal `signalRetryStage` を送信するHookを作成。
   - `out/<agent>/<revision>/summary.json` に観点→質問→証拠を整形。

## 4. UI / Developer Portal チーム
1. **登録画面**
   - 4フィールド必須フォーム + AgentCard JSON Schemaプリチェック。
   - 署名バンドルアップロードUI (PEMファイルドラッグ&ドロップ)。
2. **進捗画面**
   - Temporal `queryProgress()` から返る状態を進捗バーとして可視化。
   - 各ステージの結果概要/リンクを表示。
3. **審査結果ビュー**
   - AgentCardフィールド差戻し箇所のハイライト。
   - Sandboxログ/Inspect結果のダウンロードリンク。
4. **アクセシビリティ/国際化**
   - `ja-JP` を優先しつつ、`en-US` fallback準備。

## 5. クロスチーム項目
- **監査レジャー**: Temporal履歴ハッシュ→`audit-ledger` 投稿の共通ライブラリを `shared/audit` に切り出す。
- **Secrets管理**: Submission APIとSandbox Runnerで共有する鍵素材をVault連携に一本化。
- **Observability**: OpenTelemetryトレースIDをSubmission→Temporal→Sandbox→Judge→UIで引き回し、Grafanaダッシュボードに表示。

## 6. リスク / 未決事項
1. 署名アルゴリズム (ECDSA vs Ed25519) を早期確定。
2. Temporal Cloud vs 自前ホスティングのコスト見積を `docs/design/workflow-engine-comparison.md` に追記。
3. AdvBenchテンプレのライセンス確認。
4. Panel Judgeで利用するマルチLLMの推論コストとデータ保持要件を法務と調整。

## 7. 次ステップ
1. 各チームでチケット分割 (例: Jira) と担当アサイン。
2. `docs/design/submission-review-flow-update-20251110.md` と本メモをPRで共有し、合意形成。
3. PoCスプリント(2週間)でSubmission API + Temporal再配置まで完了させ、Sandbox/Judge/UIは並行で進める。
