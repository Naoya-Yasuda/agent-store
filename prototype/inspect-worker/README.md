# Inspect Worker PoC

`third_party/aisev` の Inspect エンジンを利用して Sandbox Runner の成果物を評価する PoC 用ディレクトリです。

## 1. 依存
- `scripts/setup_aisev.sh` を実行し、`third_party/aisev` をクローンしておく。
- Python 3.11 + Poetry or virtualenv。

## 2. シナリオテンプレート
- `scenarios/generic_eval.yaml`: `prompts/aisi/` マニフェストを読み込み、質問IDごとにInspectのEvaluationConfigを生成。
- Sandbox成果物(`response_samples.jsonl`, `policy_score.json`)を入力として評価。

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
- `out/<agent-id>/<revision>/inspect_results.json`: スコア、ログ、判定を含む。
- `out/.../inspect_stdout.log`: Inspect CLI の標準出力。

## 5. 今後のTODO
- Temporalアクティビティから直接呼び出すラッパを実装。
- Kubernetesジョブ化やサンドボックス環境分離。
