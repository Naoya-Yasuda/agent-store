# Governance Hub 設計ドラフト (2025-10-29)

## 1. 目的と役割
- 審査パイプラインの制御・統合ポイントとして、外部/内部のコンプライアンスサービス(AISI、ポリシー判定、監査ログ)をまとめる。
- 登録・更新時に提出される `Submission` ごとにリスク分類、AISI判定呼び出し、監査レジャー更新、ポリシー更新反映を担う。
- Temporalワークフローからは1つのアクティビティ(`invokeGovernance`)として呼び出され、個別のサービス連携を内部でオーケストレーションする。

## 2. 主な責務
1. **ポリシー管理**
   - `prompts/aisi/` で管理するTier別テンプレートのバージョン追跡。
   - ガバナンスポリシー更新(ブラックリスト、利用規約)の配信とロールアウト制御。
2. **リスク評価**
   - `Submission` メタデータとSandbox結果(W&B Run、policy_score)からリスクTierを再評価。
   - 例外・再審査フラグの管理。
3. **AISI連携 (Inspectベース)**
   - AISIがGitHubで提供する `Japan-AISI/aisev` をクローンし、セルフホストした評価ワーカーを起動。
   - カスタムQ&AテンプレートをInspectのシナリオとして生成し、CLI/ Python API で評価を実行。
   - レスポンスの検証、異常時は失敗ログを保存し人手レビューを強制。外部SaaSのAPIは想定せず、すべて自社インフラ内で完結させる。
4. **監査レジャー連携**
   - Temporalワークフロー履歴ハッシュ(`ledger:publish`)の実行とHTTPエンドポイントへのPOST。
   - 失敗時: 最大3回まで指数バックオフリトライ → それでも失敗した場合は `governance.ledger.failed` イベントを発行し、再試行キュー(例: SQS/Redis)へ投入 + オンコール通知。
5. **通知/アラート**
   - リスクTier変動、AISI高リスク判定、Ledger投稿失敗などをPagerDuty/Slackへ通知。

- InspectワーカーはAirflow/CeleryキューやTemporalアクティビティからジョブとして呼び出す。

## 3. インターフェース案
- **API (内部)**
  - `POST /governance/evaluate` : `Submission` ID、Sandbox指標を受け取り、Inspectジョブをキューイング。評価完了後にAISIスコア・リスクTier・レジャーIDを返却。
  - `POST /governance/policies` : ポリシー更新(4-eyes承認)を受け付け。
- **イベント**
  - `governance.evaluation.completed` : Temporalワークフローに結果を返す。
  - `governance.ledger.failed` : 再試行や担当者への通知をトリガー。

## 4. 実装ロードマップ
1. **Phase 1** (PoC)
   - Temporalアクティビティから `evaluate` APIスタブを呼び出し、`aisev` 同梱のInspect CLIをローカルで実行して評価スコアを取得。
   - 既存の `sandbox-runner` 成果物をバリデーションして `Submission` に書き戻す処理を実装。
2. **Phase 2** (MVP)
   - RBAC付きの管理UIを追加し、ポリシー更新やテンプレート差し替えを可能に。
   - Ledger HTTPエンドポイントを本番サービスに接続し、リトライキューを導入。
3. **Phase 3** (拡張)
   - 複数審査サービス(AISI以外)をプラグインとして追加。
   - メトリクス収集(評価時間、成功/失敗率)をPrometheusに出力。

## 5. 関連PoC/ドキュメント
- Temporalワークフロー: `prototype/temporal-review-workflow/`
- Sandbox Runner: `sandbox-runner/` (AISIテンプレ整合性、フェアネス指標)
- AISI プロンプト管理: `prompts/aisi/` + `scripts/validate_prompts.py`

## 6. 未決事項
- ガバナンスAPIの認証方式(OIDC vs mTLS)。
- ポリシー更新時のバージョニングとロールバック手順。
- 監査レジャーサービスとの契約要件(SLA、リージョン)。
