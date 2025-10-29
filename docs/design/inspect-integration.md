# Inspect 連携設計メモ (2025-10-29)

## 提供状況の整理
- 2025-10-29 時点でAISIは公開SaaS APIではなく、GitHubの [`Japan-AISI/aisev`](https://github.com/Japan-AISI/aisev) で Inspect ベースの評価スイートを提供。
- `aisev` にはPythonライブラリ、CLI、ベンチマーク集(`inspect_evals`)が含まれ、利用者がクローンして自前環境で評価を実行する前提。
- 従って「governance-hub」が外部HTTPエンドポイントへ審査リクエストを投げる構成は想定せず、`aisev` をクローンしてセルフホストする。

## アーキテクチャ
```
[Temporal Workflow]
       |
       v
[governance-hub API] --enqueue--> [Inspect Worker Queue]
       |                                   |
       |                                   v
       |                         [Inspect CLI/Python]
       |                                   |
       v                                   v
  Update Submission <--- store artifacts ---+
       |
       v
  Publish to Ledger (HTTP + retry)
```

### コンポーネント
- **Inspect Worker**: `aisev` リポジトリをクローンしたコンテナ。Poetry/venvで依存をインストールし、KubernetesジョブやTemporalアクティビティ内で実行。
- **Scenario Generator**: `prompts/aisi/` のマニフェストとSandbox結果を元に、InspectのEvaluationConfigを生成。
- **Result Parser**: Inspect出力(JSON/SQLite)からスコア/ログ/判定を抽出し、`Submission.aisi_score` へ保存。

## ワークフロー
1. governance-hubが`POST /governance/evaluate`を受信すると、Inspectジョブをキューイング。
2. InspectジョブはSandbox成果物(response_samples等)を入力として評価し、ログとスコアを生成。
3. 結果はS3/GCSに保存し、`Submission`へ反映。高リスク判定ならTemporalへイベントを返す。
4. 評価結果は`audit-ledger`へハッシュ化して登録(HTTPリトライ付き)。

### セットアップ手順（PoC）
1. `scripts/setup_aisev.sh` を実行し、`third_party/aisev` をクローン。
2. `.venv` を有効化してInspect/依存ライブラリをインストール。
3. Inspectワーカーコンテナ(または仮想環境)で評価スクリプトを実行。
4. サンドボックス成果物がある場合、`prototype/inspect-worker/scripts/run_eval.py` で `aisev` の `inspect run` をラップして評価を実行。
5. コンテナ実行の場合: `docker/inspect-worker/Dockerfile` でイメージをビルドし、Temporalアクティビティ側で `INSPECT_DOCKER_IMAGE` 環境変数を設定する。`AGENT_ID/REVISION/ARTIFACTS_DIR/MANIFEST_PATH` をエントリーポイントに渡す。
6. ローカル検証: `scripts/run_inspect_flow.sh` を実行すると、アーティファクト生成→イメージビルド→コンテナ実行→結果表示までを一括で確認できる。

## 技術スタック案
- Python 3.11 + `inspect-ai`
- Jobランナー: Temporal内アクティビティ or Celery + Redis
- コンテナイメージ: `governance-hub/inspect-worker:latest`
- セキュリティ: Sandboxing Toolkitの推奨（ネットワーク隔離、read-only FS）。

## TODO
- Inspectシナリオテンプレート化 (`inspect.yaml` / Python module)
- ワーカーのヘルスチェック・キュー監視
- 成果物(ログ、transcript)のガバナンスレポート連携
- Temporalアクティビティから `prototype/inspect-worker/scripts/run_eval.py` を呼び出すPoCルートを作成
