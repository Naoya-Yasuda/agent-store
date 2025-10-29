# Sandbox Runner 仕様ドラフト (2025-10-29)

## 目的
- Google ADK / LangGraph ベースのエージェントを統一インターフェースで検証し、審査前チェックに必要なログ・メトリクスを生成する。
- 生成された成果物を Weights & Biases MCP、`Submission.auto_checks`、`compliance_report` に連携し、AISI判定や人手審査の入力材料を整える。

## 実行環境
- コンテナイメージ: `agent-store/sandbox-runner:<tag>`
  - ベース: Ubuntu 22.04 + Python 3.11 + Node.js 20 (LangGraph用) + Google ADK CLI/SDK
  - 依存: LangChain/LangGraph、Google AI Platform SDK、pytest、Poetry/Pipenv
- コンフィグ: `configs/` 配下にテンプレート別の YAML を配置
  - `google_adk.yaml` : プロジェクトID、モデル、APIキー参照先(Secrets)
  - `langgraph.yaml` : グラフ構造のロード方法(リポジトリ参照 or アップロード)

## 入出力インタフェース
- 入力: `sandbox-runner` CLI で `sandbox-runner run --agent-id <id> --revision <rev>`
  - AgentメタデータをAPIから取得
  - 必要なSecretsをVault経由でフェッチ
- 出力:
  - `artifacts/response_samples.jsonl` : 質問と回答、レスポンス時間、トークン数
  - `artifacts/policy_score.json` : 安全性・コンプライアンス自動評価スコア
- `artifacts/fairness_probe.json` : 多様な入力に対する挙動(オプション)
  - `artifacts/logs/*.log` : 実行ログ
  - `artifacts/wandb-run.json` : W&B Run ID/URL
- スキーマ/マニフェスト:
  - `sandbox-runner/schemas/` にJSON Schemaを配置し、CLI実行時に `jsonschema` で検証。`fairness_probe.json` を生成する場合は専用スキーマでセグメント/スコアをチェック。
  - `prompts/aisi/manifest*.json` を参照して `questionId` の整合性をチェック。未知のIDが生成された場合はエラーとし、CIで検出。
- 成果物はS3/GCSにアップロードし、メタデータを `Submission.auto_checks` / `SampleAgentProfile.test_suite_refs` に保存

## テストフレーム
- 標準テスト: 応答時間(SLA)、ステータスコード、JSON構造、エラーハンドリング
- ドメインテスト: Google ADKテンプレートは指定プロンプト集 / LangGraphテンプレートはグラフ経路ごとの挙動
- コンプライアンステスト: 禁止語チェック、PIIマスキング確認
- 可観測性: OpenTelemetryでSpanを発行し、追跡IDをAudit Logに紐付け

## CI/CD 連携
- Pull Request時: サンプルエージェントでスモークテストを実行し、失敗時にブロック
- リリース前: 各テンプレートのリグレッションテストを走らせ、W&Bで履歴比較
- テンプレートアップデート時: 互換性ブレーク変更の場合は開発者へ通知する仕組み(Slack/Webhook)

## セキュリティ
- Secretsは実行時にフェッチし、コンテナ終了時に消去
- W&B等外部サービスへ送るログはPIIをマスキング
- サンドボックス内のネットワークアクセスは制限(許可リスト方式)

## 未決事項
- GPUが必要なエージェントの扱い(GPUプール or Fallback)
- 実行時間制限(Timeout)とコスト監視
- サードパーティ依存の健康チェック方法
