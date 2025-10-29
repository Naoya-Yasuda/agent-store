# Sandbox Runner 実装計画 (2025-10-29)

## 製品バックログ連携
- Epic: Sandbox Runner
- Stories:
  1. コンテナベースライン構築 (`Dockerfile`, Poetry/Nodeセットアップ)
  2. Google ADK テンプレート実行ハンドラー
  3. LangGraph テンプレート実行ハンドラー
  4. 成果物アップロード(S3/GCS)、メタデータ書き込みAPI
  5. W&B MCP インテグレーション
  6. CLIラッパ(`sandbox-runner run`) と設定管理

## 作業ステップ
1. **リポジトリ構造**
   ```
   sandbox-runner/
     Dockerfile
     pyproject.toml
     package.json
     src/
       python/...
       node/...
     configs/
       google_adk.yaml
       langgraph.yaml
   ```
2. **Dockerfile草案**
   - マルチステージ(依存インストール→ランタイム)
   - Python依存はPoetryで管理、Node依存はnpm/pnpm
   - OTel Collectorエージェントをサイドカーで起動できるようエントリポイント分離
3. **CLI設計**
   - `sandbox-runner run --agent-id --revision --template google-adk`
   - `--output-dir`, `--wandb-project`, `--config` オプション
   - Exit codeで成功/失敗を示し、CIブロックに利用
4. **ログ/成果物スキーマ**
   - `response_samples.jsonl`: {questionId, inputText, outputText, latencyMs, tokensOut}
   - `policy_score.json`: {score, rulesViolated[], evaluatorVersion}
   - `compliance_report.json`: sandbox総括(自動生成)
5. **W&B MCP 連携**
   - RunNameフォーマット: `sandbox/<agentId>/<revision>/<timestamp>`
   - Tags: [`template:google-adk`, `risk-tier:tier2`]
   - 成果物をW&B Artifactとしてアップロード
6. **CI連携**
   - GitHub Actionsで `sandbox-runner run --template google-adk --dry-run` を実行
   - 成果物をworkflow artifactに添付、失敗時はPRを赤くする
7. **セキュリティ/コンプライアンス**
   - SecretsをAWS/GCP Secrets Managerからサイドカー経由で受け取る
   - TMPディレクトリはプロセス終了時に削除
   - ネットワークEgressはテンプレに必要なドメインだけ許可

## 依存
- Google ADK SDK / LangGraph ライブラリのライセンス確認
- W&B APIキーの組織管理
- S3/GCS バケットの命名規約とライフサイクル管理

## 完了基準
- Google ADK / LangGraph テンプレを用いたエージェントでスモークテストが成功
- 成果物が `docs/design/sandbox-runner-spec.md` の要件を満たす
- W&B Run と `Submission.auto_checks` が連携し、CIで検証可能
