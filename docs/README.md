# Agent Store Documentation

## 0. リサーチドリブン設計原則
| ソース | 主な示唆 | 設計への適用箇所 |
| --- | --- | --- |
| `docs/papers/responsible-ai-agents-2502.18359.pdf` | オープンエージェント市場における安全性・透明性ガードレールの必要性 | ガバナンス層の分離、審査ログの公開メタデータ化 |
| `docs/papers/automated-risky-game-2506.00073.pdf` | リスク分層と多層審査、利害関係者連携 | リスクTier設計、エスカレーションポリシー |
| `docs/papers/fama-fair-matching-2509.03890.pdf` | 公平マッチングの指標と最適化フレーム | 推薦サービスと公平性メトリクス管理 |
| `docs/papers/governance-as-a-service-2508.18765.pdf` | ガバナンス機能のサービス化・モジュール化 | `governance-hub` サービス、外部審査API連携 |
| `docs/papers/decentralized-gradient-marketplaces-2509.05833.pdf` | 分散マーケットプレイスのロバスト性指標 | TrustSignal、SLAモニタリング設計 |
| `docs/papers/marketplace-for-ai-models-2003.01593.pdf` | 収益化・トレーサビリティ・監査の初期課題 | 取引ログ保存ポリシー、コンプライアンス連携 |

これらの知見を踏まえてアーキテクチャ・データモデル・ワークフローを再設計する。

## 1. アーキテクチャ概要
- 三層構造を **利用者体験層(カタログ/推薦)**、**開発者エクスペリエンス層(登録/運用)**、**ガバナンス層(審査/監査/政策連携)** に再編し、各層ごとにSLO・監査要件・責務を分離。
- 利用者体験層は `catalog-api`, `recommendation-service`, `fairness-metrics-store` を中核とし、FaMA論文の示す公平性指標(Exposure Parity, Satisfaction Gap)を定期計測し推薦アルゴリズムに反映。
- 開発者エクスペリエンス層は `developer-portal`, `agent-build-service`, `sandbox-runner`(Google ADK / LangGraph テンプレート実行)で構成し、提出前の自動テストとコンプライアンスチェックを強制。
- ガバナンス層に `review-workflow`, `governance-hub`, `audit-ledger`, `policy-insights-dashboard` を配置。`governance-hub` はAISIや第三者監査APIをプラガブルに接続し、ポリシー更新を段階的に反映。
- イベント分配はKafka/SNSを使用。`audit-ledger` はQLDB等のAppend-onlyストレージとハッシュチェーンで改ざん検知。
- サンプル実装では Google AI Developer Kit (Google ADK) を使用した基準エージェントを `sandbox-runner` で自動検証。LangGraphベースエージェントも同一エンドポイント契約で登録可能にする。
- ネットワーク境界はゼロトラスト方針。利用者向けAPIと管理系APIは別ドメイン・API Gatewayで提供し、Secretsは中央Vaultで管理。

```
[Consumer UI] -> [catalog-api] -> [Search/Cache] -> [fairness-metrics-store]
                                   |--> [recommendation-service] (公平性補正)

[Developer UI] -> [developer-portal] -> [AgentStore DB]
                                   |--> (events) --> [review-workflow] -> [governance-hub] -> (AISI / 外部審査)
                                   |--> [sandbox-runner] (Google ADK / LangGraph テンプレート)
                                   |--> [audit-ledger] -> [policy-insights-dashboard]
                                              |
                                              v
                                   [catalog-indexer] -> [Search/Cache] -> [catalog-api]
```

## 2. データモデルとAPI
- エージェント、カード、URL、提出物、信頼/公平性指標を統合的に管理。
- 公開/管理向けAPIの契約と認証方針を定義し、ガバナンス操作は4-eyes(二人承認)を必須にする。

### 2.1 コアエンティティ

| エンティティ | 主なフィールド | 説明 |
| --- | --- | --- |
| Agent | `id (UUID)`, `slug`, `display_name`, `owner_id`, `status`, `default_endpoint_id`, `created_at`, `updated_at` | エージェント本体。公開状態(`draft`,`in_review`,`published`,`suspended`)を管理。 |
| AgentRevision | `id`, `agent_id`, `version`, `change_summary`, `changelog`, `submitted_by`, `submitted_at`, `risk_tier` | バージョン履歴とリスクTierを保持し、必要な審査レベルを決定。 |
| AgentCard | `id`, `agent_id`, `locale`, `summary`, `capabilities`, `use_cases`, `cover_image_url`, `policy_disclosures` | カタログ表示用メタ情報と政策上の開示事項。 |
| AgentEndpoint | `id`, `agent_id`, `type`, `url`, `auth_scheme`, `expected_latency_ms`, `health_status`, `sla_tier` | 実行エンドポイントとSLA情報。 |
| Submission | `id`, `agent_revision_id`, `submitter_id`, `state`, `risk_tier`, `auto_checks`, `aisi_score`, `fairness_score_snapshot`, `review_notes` | 多段審査の状態と自動判定結果、統計を格納。 |
| AuditLog | `id`, `actor_id`, `action`, `target_type`, `target_id`, `payload`, `created_at`, `hash_chain_id` | ハッシュ連結した監査ログ。透明性レポート作成の基礎。 |
| SampleAgentProfile | `id`, `framework`, `model_provider`, `intended_use`, `compliance_report`, `test_suite_refs` | テスト用サンプルエージェント。Google ADK基準を初期レコードとして保持。 |
| FairnessMetricSnapshot | `id`, `agent_id`, `metric_type`, `value`, `population_segment`, `calculated_at` | 推薦公平性指標の履歴。(FaMAベース) |
| TrustSignal | `id`, `agent_id`, `source`, `signal_type`, `value`, `decay_policy`, `collected_at` | 信頼性シグナル。ロバスト性/不正検知の評価に利用。 |

### 2.2 永続化と補助ストア
- `Agent`/`Submission`等はRDB(PostgreSQL)で管理。`FairnessMetricSnapshot`/`TrustSignal`はTimescaleDBやInfluxDBなどの時系列DBで保管。
- 全文検索やタグ検索はOpenSearchにインデックス化。公平性指標は検索キャッシュにサマリーとして配置し、推薦結果補正に使用。
- 大容量アセットはオブジェクトストレージ(S3/GCS)に保存し、署名URLでアクセス制御。
- API呼び出しログや取引履歴はデータレイク(BigQuery/Athena)にストリーミングして収益分配・監査分析に活用。
- `audit-ledger` はQLDB/Spanner/Fabric等の改ざん検知可能なストアを利用し、重要イベントを外部監査機関へエクスポート。

### 2.3 API設計 (抜粋)

| API | メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- | --- |
| Create Agent Draft | POST | `/v1/agents` | OAuth2 client_credentials (developer) | 新規ドラフト作成。 |
| Update Agent Draft | PATCH | `/v1/agents/{agentId}` | OAuth2 | メタデータ更新、カード情報アップロード。 |
| Submit For Review | POST | `/v1/agents/{agentId}/submissions` | OAuth2 | 審査用リビジョンを作成しパイプラインに送信。 |
| Sandbox Test Trigger | POST | `/v1/agents/{agentId}/sandbox-tests` | OAuth2 | Google ADK / LangGraph テンプレートで自動テスト実行。 |
| List Catalog | GET | `/public/catalog` | APIキー | 公開エージェントの検索(公平性補正済みランキング)。 |
| Get Agent Detail | GET | `/public/catalog/{slug}` | APIキー | カード情報、利用方法、エンドポイント。 |
| Admin Approve/Reject | POST | `/admin/submissions/{submissionId}/decision` | OAuth2 + RBAC | 多段審査の判定とコメント登録。 |
| Governance Policy Update | POST | `/admin/governance/policies` | RBAC + 4-eyes | ガバナンスルール更新をハッシュ記録。 |
| Fairness Metrics Export | GET | `/admin/metrics/fairness` | OAuth2 + Export Scope | 指標の期間エクスポート。 |
| Trust Signal Feed | GET | `/admin/metrics/trust-signals` | OAuth2 + Monitoring Scope | ロバスト性・稼働指標の取得。 |
| Webhook (AISI) | POST | `/webhooks/aisi` | HMAC署名 | AISI判定結果の受信エンドポイント。 |

- OpenAPI仕様書とGraphQL SDLをリポジトリ管理し、CIで互換性チェック。
- APIメトリクス(レイテンシ/エラー率/リスクエスカレーション数)をPrometheusなどで収集。

## 3. 登録・審査ワークフロー
- 開発者ポータルからの登録手順と自動審査パイプラインを多段化。
- フレームワーク非依存ながらもGoogle ADK/ LangGraphテンプレートで標準テストを実施し、審査側は出力品質を主眼に判断。

### 3.1 ステップ一覧
1. **Draft**: 開発者がエージェント情報を入力し、ドラフトとして保存。フォームのスキーマ検証を同期実行。
2. **Sandbox Validation**: `sandbox-runner` がGoogle ADK / LangGraphテンプレートで動作確認。レスポンスとポリシー適合性を `compliance_report` に記録。
3. **Risk Tiering**: `governance-hub` が利用領域/ユーザ影響/自己学習有無を評価しリスクTierを決定。Tierに応じた審査者割当とSLAを設定。
4. **Pre-flight Checks**: API疎通テスト、スキーマ検証、Secrets検査、脆弱性スキャンを自動実施し、`Submission.auto_checks` に保存。同時にWeights & Biases MCPへSandbox結果とメトリクスを送信し、ゲート条件を満たさない限り次ステップに進ませない。
5. **AISI 判定**: AISI APIへ非同期送信し、結果をWebhook経由で取り込み。質問テンプレートと想定回答のマッピング(ストア固有のカスタムQ&A)をリクエストに添付し、判定モデルが適切な文脈で評価できるようにする。高リスクフラグは自動でTierを引き上げる。
6. **Fairness Audit (対象のみ)**: 高可視性エージェントに対しFaMAシミュレーションを実施し、`Submission.fairness_score_snapshot` を取得。
7. **Human Review (多段)**: 技術レビュー→政策/リーガルレビュー→セキュリティレビューの順で実施。Temporal等のワークフローエンジンでSLAを監視し、期限超過は自動エスカレーション。
8. **Decision & Publication**: 承認で`published`へ、却下で理由通知。公開イベントが `catalog-indexer` を更新し、キャッシュと公平性指標を再計算。
9. **Post-Publish Monitoring**: SLI/SLO監視、利用者フィードバック、TrustSignal更新を実施。閾値超過時は自動的に`escalated`状態へ戻し、審査を再開。

### 3.2 状態遷移

| Submission.state | 説明 | トリガー |
| --- | --- | --- |
| `draft` | 開発者が編集可能 | 初回作成 |
| `sandbox_validation` | テンプレート検証中 | Draft -> Sandbox Validation |
| `pending_checks` | 自動チェック中 | Sandbox Validation完了 |
| `risk_assessment` | リスクTier決定中 | 自動チェック完了 |
| `needs_fix` | 自動チェック/判定で失敗 | 開発者修正 |
| `pending_review` | 人手審査待ち | リスクTier確定 + 自動判定クリア |
| `escalated` | 追加レビュー待ち | 高リスク判定 or SLA違反検知 |
| `approved` | 公開可能 | 多段審査完了 |
| `rejected` | 公開不可、理由付通知 | レビュアー却下 or リスク再評価 |
| `published` | カタログ反映済み | 自動公開ジョブ |

### 3.3 AISI/ガバナンス連携考慮点
- 入力データはPIIマスキング後に送付し、送信ログとモデルバージョンを`Submission.auto_checks`に記録。
- ストア固有のQ&Aテンプレートを `aisi_prompts` としてバージョン管理し、質問文・期待回答・許容誤差を添付。AISI側でコンテキスト切替を行い、モデルが誤判定しないよう評価指標をカスタムする。
- リスクTierごとにマニフェスト(`prompts/aisi/manifest.tier{N}.json`)を用意し、Sandbox Validationで使用された `questionId` が適切なマニフェストに含まれているか検証する。
- Tierごとの最低評価カテゴリ: Tier1=Safety、Tier2=Safety+Privacy、Tier3=Safety+Privacy+Misinformation。CIの `scripts/validate_prompts.py` でカテゴリ欠落を検出する。
- AISI審査は外部SaaSではなく、公式リポジトリ [`Japan-AISI/aisev`](https://github.com/Japan-AISI/aisev) をクローンしたInspect環境で自社ホストする。`scripts/setup_aisev.sh` でセットアップし、`docs/design/inspect-integration.md` に従ってワーカーを起動する。
- AISI API失敗時は指数バックオフで3回再試行。それでも不可なら`needs_fix`へ戻し開発者に再提出を促す。
- `governance-hub` はAISI以外の第三者審査(政策評価サービス等)をプラガブルに追加可能。各サービスのSLA/バージョンを監査ログに記録。
- リスクTier高のエージェントは公開後も継続監視対象となり、TrustSignalの低下やインシデント発生で自動サスペンド。
- Weights & Biases MCPはSandbox ValidationとPre-flight Checksの観測・可視化・ゲーティングに利用し、合格条件を満たしたRunのみが審査フェーズへ進める。監査証跡は公式には`audit-ledger`に残し、MCPは運用改善とメトリクス共有に限定。

### 3.4 運用/監査
- すべての遷移・ガバナンス操作を `audit-ledger` に記録し、四半期ごとに透明性レポートを発行。
- SLA違反やAPI規約違反はオンコールへ自動通知。TrustSignal閾値を超過したエージェントは`escalated`状態に遷移。
- 公平性・信頼性指標をダッシュボードで可視化し、Responsible AIチームが閾値を調整可能。
- 政策変更時は `governance-hub` 経由でロールアウト計画を登録し、マイグレーション中の影響をモニタリング。

## 4. 未決事項 / 次のアクション
- **Workflow Engine**: Temporal / Step Functions / Airflow の比較表と採用指針 (運用費用、SLA、リトライ制御、JavaScript/Python SDKサポート) を作成し、PoC計画を固める。
- **Sandbox Runner**: Google ADK / LangGraph テンプレートのディレクトリ構成、コンテナイメージ、依存ライブラリ、出力アーティファクト(JSONログ、W&B Run ID)のスキーマを定義。
- **MCP Metrics**: Weights & Biases MCPで収集するメトリクス項目(応答時間、ポリシースコア、不適切率等)と合格閾値、Run命名規則、通知チャネル(Slack等)を決定。
- **Audit Ledger**: ハッシュチェーン構造、署名方式(KMS / HSM)、公開サマリー生成手順、外部監査機関へのエクスポートフローを仕様化。
- **Trust/Fairness Signals**: データ収集ポイント(ログイベント/バッチ集計)、計算周期、しきい値、可視化ダッシュボードのワイヤーフレームを設計。
- **AuthN/AuthZ**: OAuth/OIDCクライアント管理、APIキー発行ポリシー、RBACロール(開発者/レビュアー/ガバナンス管理者)の定義と監査ログ連携。
- **Sample Agents**: Google ADK基準エージェントとLangGraphテンプレートの仕様書、CIテストケース、更新ポリシー(破壊的変更時の周知)を記述。
- **Transparency & Business**: 透明性レポートのフォーマット/発行サイクル、収益分配・課金モデル検討(ロイヤリティ、サブスクリプション、従量課金)のロードマップを整理。
- **AISI Integration**: AISI API仕様の入手先、クライアントラッパー設計、署名・リトライ・バージョン管理方針、ログのマスキング手順をまとめる。

---
最終更新: 2025-10-29 (UTC-07:00 推定)
