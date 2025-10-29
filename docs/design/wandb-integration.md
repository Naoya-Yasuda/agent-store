# Weights & Biases Integration メモ (2025-10-29)

## 概要
- Sandbox Runner で `WANDB_DISABLED=false` に設定すると、実際に WandB Run を作成し、Sandbox成果物（response/policy/fairness）とメトリクスをアップロードする。
- Temporal ワークフロー/CI での品質ゲートとして、メトリクス閾値やRunステータスを参照する計画。

## 設定
- 必須環境変数: `WANDB_API_KEY`, `WANDB_ENTITY`, `WANDB_PROJECT` (CLI引数で上書き可)
- CLIオプション: `--wandb-project`, `--wandb-entity`, `--wandb-base-url`
- デフォルトは `WANDB_DISABLED=true`。実Run登録時のみ `false` に変更。

## 実行フロー
1. Sandbox Runner 実行時に `wandb.init()` を呼び出し、Runを作成。
2. 基本メトリクス (`policy_score`, 平均レスポンス時間など) を `wandb.log()`。
3. 主要成果物(response_samples, policy_score, fairness_probe) を `wandb.save()` で添付。
4. Run URL を `metadata.json` に記録し、ワークフロー／ポータルで参照。

## セキュリティ/運用
- APIキーはSecrets Manager等で管理し、CI環境では保護された変数を使用。
- PIIや秘匿情報はアップロード前にマスキング。
- Exportや外部共有ポリシーを定め、監査要件を満たすようにする。

## TODO
- WandB Run作成時にタグやConfigを整備（テンプレート種類、リスクTierなど）。
- Circle/TemporalでRunステータスを参照し、閾値違反でパイプラインを停止する仕組みを実装。
- 監査レポート向けにWandBのRunサマリを定期取得するスクリプトを用意。
