# Inspect Worker PoC

`third_party/aisev` の Inspect エンジンを利用して Sandbox Runner の成果物を評価する PoC 用ディレクトリです。

## 1. 依存
- `scripts/setup_aisev.sh` を実行し、`third_party/aisev` をクローンしておく。
- Python 3.11 + Poetry or virtualenv。

## 2. 評価フロー
- `scripts/run_eval.py` が Sandbox Runner のレスポンスを `inspect_ai` の `Task` と `Sample` に変換し、リプレイ用ソルバーで回答を流し込む。
- デフォルトの判定モデルは `mockllm/model`（外部API不要）。`INSPECT_GRADER_MODEL` を設定するとOpenAI等のモデルで `model_graded_qa` 判定を行う。
- 評価用データは `inspect_dataset.jsonl` に書き出され、`inspect_logs/` 配下に JSON ログが保存される。

## 3. 実行例
```
poetry install
poetry run python scripts/run_eval.py \
  --agent-id demo \
  --revision rev1 \
  --artifacts ../../sandbox-runner/artifacts \
  --manifest ../../prompts/aisi/manifest.tier3.json
```

### コンテナ経由のPoC実行
```
scripts/run_inspect_flow.sh
```
上記スクリプトは、Sandbox成果物の生成→Inspectワーカーイメージのビルド→コンテナ実行→サマリ表示までを一括で実行します。

## 4. 出力
- `out/<agent-id>/<revision>/summary.json`: 合格率、ポリシースコア、判定件数、利用した判定モデル等。
- `out/<agent-id>/<revision>/details.json`: 質問IDごとの判定（Judgeのグレード/説明含む）。
- `out/<agent-id>/<revision>/inspect_dataset.jsonl`: 評価に供した入力・期待値・出力のスナップショット。
- `out/<agent-id>/<revision>/inspect_log_index.json`: Inspectログのパスと集計メトリクス。
- `out/<agent-id>/<revision>/inspect_logs/*.json`: `inspect_ai` が生成する元ログ(JSON形式)。

## 5. 主な環境変数
- `INSPECT_GRADER_MODEL`: 判定に使うモデルID。例: `openai/gpt-4o-mini`。
- `INSPECT_REPLAY_MODEL`: ログに埋め込むリプレイ用モデル名 (既定値: `replay`)。
- `INSPECT_USE_PLACEHOLDER`: `"true"` の場合、既存のヒューリスティック判定にフォールバック。

## 6. 今後のTODO
- Temporalアクティビティから直接呼び出すラッパを実装。
- Kubernetesジョブ化やサンドボックス環境分離。
