# Agent Store Documentation

## 1. アーキテクチャ概要
- 開発者向けポータル、審査パイプライン、公開カタログAPIの三領域を分離し、責務とデプロイの独立性を確保する。
- バックエンドは軽量なマイクロサービス構成を想定。初期段階では同一クラスタ内に `developer-portal`, `review-workflow`, `catalog-api` の3サービスを配置し、必要に応じてサーバレス(Lambda + DynamoDB)からKubernetes/ECSへ拡張可能とする。
- データはRDB(PostgreSQL等)で厳格な整合性を担保しつつ、公開カタログはElasticsearchやOpenSearchで検索性を向上。更新イベントはメッセージキュー(Kafka/SQS)で配信し、最終的にキャッシュ/CDNを更新する。
- 認証は開発者ポータルでOAuth2(あるいはOIDC)を利用し、公開APIはAPIキー + レート制限で保護する。管理用にはRBACを導入し、CloudTrail相当の監査ログを保存する。
- サンプル実装では Google AI Developer Kit (Google ADK) を利用した基準エージェントを用意し、審査・公開パイプラインのE2E確認が可能な状態にする。LangGraphベースのエージェントも登録できるよう、エンドポイント仕様はフレームワーク非依存で定義する。

```
[Developer UI] -> [developer-portal API] -> [AgentStore DB]
                                   |--> (events) --> [review-workflow] -> [AISI 判定 API]
                                                                |
                                                                v
                                               [catalog-indexer] -> [Search/Cache] -> [catalog-api]
```

## 2. データモデルとAPI
- エージェント、カード、URL、提出物などのデータ構造定義。
- 公開/管理向けAPIの契約と認証方針。

### 2.1 コアエンティティ

| エンティティ | 主なフィールド | 説明 |
| --- | --- | --- |
| Agent | `id (UUID)`, `slug`, `display_name`, `owner_id`, `status`, `default_endpoint_id`, `created_at`, `updated_at` | エージェント本体。公開状態(`draft`,`in_review`,`published`,`suspended`)を管理。 |
| AgentRevision | `id`, `agent_id`, `version`, `change_summary`, `changelog`, `submitted_by`, `submitted_at` | バージョン履歴。審査やロールバック用に差分を保持。 |
| AgentCard | `id`, `agent_id`, `locale`, `summary`, `capabilities`, `use_cases`, `cover_image_url` | カタログ表示用のメタ情報(多言語対応)。 |
| AgentEndpoint | `id`, `agent_id`, `type`, `url`, `auth_scheme`, `expected_latency_ms`, `health_status` | 実行エンドポイントとSLA情報。 |
| Submission | `id`, `agent_revision_id`, `submitter_id`, `state`, `auto_checks`, `aisi_score`, `review_notes` | 審査パイプラインの進行状況と判定結果を格納。 |
| AuditLog | `id`, `actor_id`, `action`, `target_type`, `target_id`, `payload`, `created_at` | 監査用アクションログ。 |
| SampleAgentProfile | `id`, `framework`, `model_provider`, `intended_use`, `compliance_report` | テスト用サンプルエージェント。Google ADKベースを初期レコードとして保持し、審査フローの自動テストに利用。 |

### 2.2 永続化と補助ストア
- 取引整合性が重要な `Agent`/`Submission` はRDBで管理。全文検索やタグ検索は整形したイベントをOpenSearchに投入してインデックス化。
- 大きな添付ファイル(デモ動画、ドキュメント)はオブジェクトストレージに保存し、S3署名URLをDBに格納。
- 分析や課金に備えて、API呼び出しログは別途データレイク(GCS/Athena)にストリーミング。

### 2.3 API設計 (抜粋)

| API | メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- | --- |
| Create Agent Draft | POST | `/v1/agents` | OAuth2 client_credentials (developer) | 新規ドラフト作成。 |
| Update Agent Draft | PATCH | `/v1/agents/{agentId}` | OAuth2 | メタデータ更新、カード情報アップロード。 |
| Submit For Review | POST | `/v1/agents/{agentId}/submissions` | OAuth2 | 審査用リビジョンを作成しパイプラインに送信。 |
| List Catalog | GET | `/public/catalog` | APIキー | 公開エージェントの検索(フィルタ: タグ、モデル種別)。 |
| Get Agent Detail | GET | `/public/catalog/{slug}` | APIキー | カード情報、利用方法、エンドポイント。 |
| Admin Approve/Reject | POST | `/admin/submissions/{submissionId}/decision` | OAuth2 + RBAC | 人手審査での判定。 |
| Webhook | POST | `/webhooks/aisi` | HMAC署名 | AISI判定結果の受信エンドポイント。 |

- OpenAPI仕様書を自動生成し、CIでスキーマ互換性チェックを実施。GraphQLを併設する場合もSDLをリポジトリで管理。
- 各APIでメトリクス(レイテンシ、エラー率)をPrometheusなどで収集し、SLO違反時のアラートを構成。

## 3. 登録・審査ワークフロー
- 開発者ポータルからの登録手順。
- 自動審査パイプラインとAISI判定の統合設計。

### 3.1 ステップ一覧
1. **Draft**: 開発者がエージェント情報を入力し、ドラフトとして保存。フォームのスキーマ検証を同期的に実行。
2. **Pre-flight Checks**: SubmitアクションでQueueに投入。ポータル側でAPI疎通テスト、OpenAPIスキーマ/JSON Schemaの静的検証、秘密情報の誤埋め込みチェックを自動実施。
3. **AISI 判定**: 判定用ジョブがAISI APIに非同期リクエスト。結果はWebhook/ポーリングで受信し、`Submission.auto_checks` に保存。
4. **Human Review (必要時)**: 高リスクフラグやAISIスコア閾値超過でレビュアーにタスク割り当て。Temporal等のワークフローエンジンでSLA(例:24h)を監視。
5. **Publish**: 承認されたリビジョンを`published`に変更。イベントをトリガーにカタログインデクサが更新を反映。キャッシュを破棄。
6. **Post-Publish Monitoring**: 稼働中のSLI/SLO監視、ユーザーレポートをポータルで収集。違反時は自動で`Suspended`に遷移し通知。

### 3.2 状態遷移

| Submission.state | 説明 | トリガー |
| --- | --- | --- |
| `draft` | 開発者が編集可能 | 初回作成 |
| `pending_checks` | 自動チェック中 | Submitボタン |
| `needs_fix` | 自動チェックで失敗 | 開発者の再提出 |
| `pending_review` | 人手審査待ち | AISIクリア + フラグ条件 |
| `approved` | 公開可能 | レビュアー承認 |
| `rejected` | 公開不可、理由付通知 | レビュアー却下 or AISI高リスク |
| `published` | カタログ反映済み | 自動公開ジョブ |

### 3.3 AISI連携の考慮点
- 入力データはPIIマスキング後に送付し、送信ログとモデルバージョンを`Submission.auto_checks`に記録。
- AISI APIが失敗した場合は指数バックオフ再試行を最大3回。それでも失敗なら`needs_fix`に戻し再提出を促す。
- 高リスクカテゴリーに該当する場合は自動停止フラグを立て、公開後も継続モニタリング対象とする。
- 審査判断は入出力の安全性・コンプライアンス基準に基づき、LangGraphやGoogle ADKなど開発者が利用するフレームワークは原則不問。テストでは準拠するAPI契約とSLAが満たされているか、観測結果に基づいて評価する。

### 3.4 運用/監査
- すべての遷移イベントをAuditLogに記録し、BIツールで可視化。監査証跡として最低1年間保持。
- SLA違反・API利用規約違反は自動通知し、オンコール/サポートチームとPagerDuty連携。

## 4. 未決事項 / 次のアクション
- 審査ワークフローを実装する基盤(Temporal vs. Step Functions等)の選定。
- AISI判定ルールセット・カテゴリ分類の詳細、スコア閾値設定。
- カタログ検索におけるランキングアルゴリズムとシグナルの定義。
- 将来の課金/メータリング要件と収益化プラン。
- サンプルエージェント(Google ADK)の仕様書と自動テストケースの整備。

---
最終更新: 2025-10-29 (UTC-07:00 推定)
