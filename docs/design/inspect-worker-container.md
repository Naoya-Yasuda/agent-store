# Inspect Worker コンテナ & リトライ設計 (2025-10-29)

## 1. 目的
- `third_party/aisev` をベースにした Inspect 評価をコンテナ化し、Temporal から安全に実行できるようにする。
- ネットワーク隔離・接続制限・APIキー管理を明確化。
- 評価失敗時の再試行/再キュー戦略を定義。

## 2. コンテナ構成案
- ベースイメージ: `python:3.11-slim`
- 依存: `pip install -r third_party/aisev/requirements.txt`
- 開始スクリプト: `entrypoint.sh` が `scripts/run_eval.py` を呼び出し、結果をS3/GCSへ保存。
- 環境変数:
  - `AISEV_HOME=/app/third_party/aisev`
  - `PROMPTS_MANIFEST=/app/prompts/aisi/manifest.tier3.json`
  - `WANDB_DISABLED=false` (Sandbox漫遊時に切り替え)
- セキュリティ:
  - 任意ネットワークアクセスは禁止 (必要なEndpointのみ)
  - ファイルシステムをRead-onlyでマウントし、成果物は `/tmp/out` に出力。

## 3. Temporal との連携
- Temporal Worker がDockerコンテナを起動する (例: Kubernetes Job / AWS Batch).
- `invokeAISI` アクティビティ内で `run_eval.py` を直接実行しているが、今後はコンテナ実行API (Kubernetes, Batch, ECS) に切り替える。
- 結果の収集: ジョブ完了後にS3/GCSから結果をダウンロード。

## 4. リトライ戦略
- Inspect Workerが失敗した場合:
  1. Temporalアクティビティで自動リトライ (指数バックオフ、回数3回)
  2. それでも失敗した場合は `governance.aisi.failed` イベントを発行し、人手審査へエスカレーション。
  3. Failedジョブは再実行キュー (SQS/Redis) に記録し、オンコール通知。

## 5. TODO
- Dockerfile作成 (`docker/inspect-worker/Dockerfile`)
- `run_eval.py` をコンテナ向けに調整 (入出力を環境変数化)
- Temporalアクティビティをコンテナ呼び出し版に置き換え
- 監視メトリクス: ジョブ成功率、平均所要時間、再試行回数
