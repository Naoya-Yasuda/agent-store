# Temporal ワークフロー PoC 計画 (2025-10-29)

## 目的
- 審査フロー(Draft -> Sandbox -> Checks -> Review -> Publish)をTemporalで実装可能か検証し、運用コスト・権限設計・監査連携を評価する。

## スコープ
1. 最小限のワークフローをTypeScript SDKで実装
   - Workflow: `ReviewPipelineWorkflow`
   - Activities: `fetchAgentDraft`, `runSandbox`, `runAutoChecks`, `invokeAISI`, `triggerHumanReview`, `publishAgent`
2. Temporal Cloud vs 自前ホスティング(EKS)のコストと管理負荷比較
3. `audit-ledger` との統合: ワークフロー履歴IDとハッシュを連携できるか確認
4. アラート/監視: SLA違反時にPagerDutyへ通知する仕組みの可否

## タスク詳細
- **環境構築**
  - Temporal Cloud trial を申請 / 自前なら `docker compose` (同ディレクトリの `docker-compose.yml`) で temporalite を起動してローカル検証
  - TypeScript SDK + Node 20 プロジェクトを `prototype/temporal-review-workflow/` に作成（既存PoCを拡張）
- **ワークフロー実装**
  - 状態遷移をTemporalのSignals/Queriesで外部更新可能にする
  - `runSandbox` はHTTPスタブをコール、`invokeAISI` もモック
  - エラー/タイムアウト時のRetryPolicyを設定
- **権限/セキュリティ**
  - Temporal CloudのNamespace RBACを検証(レビュアー/運用者のアクセスコントロール)
  - SecretsはAWS Secrets Manager経由でWorkerに供給する動線を確認
- **監査連携**
  - WorkflowExecutionHistoryを取得し、SHA256でハッシュ化して `audit-ledger` に書き出すPoCスクリプト（`Makefile client` 実行で生成される履歴を対象）
  - 履歴量とAPI制限の影響を評価
- **コスト試算(概算)**
  - Temporal Cloud: 月間オペレーション数 x 単価 (例: 50kワークフロー / 月)
  - 自前EKS: m5.large * N台 + 管理コスト(人件費見積もり)
  - Step Functions比較: 状態遷移数*単価で試算

## 成功条件
- Temporalワークフローで審査フロー基本ステップが動作し、リトライ/エスカレーションが確認できる
- 監査連携とアラート経路が概念実証できる
- コスト比較表が作成され、意思決定材料となる

## 次アクション
1. Temporal Cloudアカウント申請 / セキュリティチェック
2. プロトタイプリポジトリ作成と最小ワークフロー実装
3. 成果まとめを `docs/design/workflow-engine-comparison.md` に追記
