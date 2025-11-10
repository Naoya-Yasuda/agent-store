# W&B Run ID 伝播計画 (2025-11-10)

## 1. ゴール
- Submission API → Temporal Workflow → Sandbox Runner → Inspect Worker → Human Review UI まで、単一の W&B Run ID を引き回し、すべてのステージ成果物・メトリクスを1つのRunで可視化する。
- Run URL を `metadata.json` / Temporal progress / Human Review UI から参照できるようにし、レビュワーや監査担当が即座にログへアクセスできるようにする。

## 2. 現状
- Sandbox Runner は `wandb_mcp` ヘルパーで Run ID / W&B URL を `metadata["wandbMcp"]` に保存し、Security Gate / Functional Accuracy のアーティファクトを Run に紐付けている。
- Temporal / Inspect / Human Review UI は Run ID を受け取っておらず、Judge結果やHuman Review操作はRunと連動していない。

## 3. 必要な変更
1. Submission API (`api/routes/submissions.ts`)
   - 実装済み: `telemetry.wandb` オブジェクトで `runId`/`project`/`entity`/`baseUrl` を受け付け、`submissions.wandb_run` JSONB カラムに保存する。
   - TODO: 省略時にサーバ側でRun IDを自動払い出し、Temporalイベントへ含める。
2. Temporal Workflow (`prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts`)
   - `WorkflowProgress` に `wandbRun` 情報を追加 (ID, URL)。
   - 各アクティビティに Run 情報を渡し、ログがあれば `metadata.statusReason` にW&Bリンクを記録。
3. Sandbox Runner (`sandbox_runner/cli.py`)
   - `wandb_info` をCLI引数（`--wandb-run-id`, `--wandb-entity`, `--wandb-project`, `--wandb-base-url`）で上書き可能にし、Submission/Temporalから渡されたRunを使い続ける。
   - `metadata.json` にRun情報を既に記録しているため、Submission→Temporal→UIでメタデータを参照してRun URLを表示できる。
4. Inspect Worker (`prototype/inspect-worker/scripts/run_eval.py`)
   - CLIに `--wandb-run-id` などのパラメータを追加し、Judge Panel / Inspect結果を同じRunにアタッチする（`wandb_mcp`の軽量版をInspect側にも導入する）。
5. Human Review UI
   - `queryProgress`レスポンスにRun URLを含め、レビュワーがRunダッシュボード（Security/Functional/Judgeログ）へ遷移できるリンクを表示。
   - `signalRetryStage`/承認操作時にRun IDを添えて監査ログへ記録。

## 4. 実装ステップ
1. Submission APIへRun情報フィールド追加。DB/イベントスキーマを更新。
2. Temporal Workflow入力 (`ReviewPipelineInput`) に `wandbRun` セクションを追加し、`progressQuery` でも返す。
3. Sandbox Runner CLIへ `--wandb-run-id` 等の引数追加・`init_wandb_run` の上書きロジック実装。
4. Inspect WorkerにW&Bラッパーを導入し、Judge成果物をRunにアタッチ。
5. Human Review REST APIとUIモックにRun URL表示＋操作ログ記録を追加。
