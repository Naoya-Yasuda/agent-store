# W&B Run ID 伝播計画 (2025-11-10)

## 1. ゴール
- Submission API → Temporal Workflow → Sandbox Runner → Inspect Worker → Human Review UI まで、単一の W&B Run ID を引き回し、すべてのステージ成果物・メトリクスを1つのRunで可視化する。
- Run URL を `metadata.json` / Temporal progress / Human Review UI から参照できるようにし、レビュワーや監査担当が即座にログへアクセスできるようにする。

## 2. 現状 (2025-11-11 時点)
- Sandbox Runner / Inspect Worker は `wandb_mcp` ヘルパーで Run ID / W&B URL を `metadata["wandbMcp"]` に保存し、Security Gate / Functional Accuracy / Judge Panel のアーティファクト・サマリ・Ledger情報をRunに紐付け済み。
- Human Review UI と REST API (`/review/ui`, `/review/ledger`) は `queryProgress` / `wandbMcp.stages` からRun URL・LLM設定・Ledgerダイジェストを取得し、Next.js/HTML双方で表示できるようになった。
- Temporal ワークフローは `signalHumanDecision` を受け取った後に `recordHumanDecisionMetadata` アクティビティを呼び出し、Humanステージの決裁結果を `metadata.json` / `wandbMcp.stages.human` に反映している。

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
5. Human Review UI / REST
   - 実装済み: `queryProgress`レスポンスにRun URLとステージ詳細を含め、UIでW&Bダッシュボードリンクを表示。Ledgerのみ必要な場合は `GET /review/ledger/:submissionId` でJSON取得。
   - TODO: Run ID自動払い出し（Submission省略時）とHuman Review操作ログをW&Bにタイムラインとして投稿。
6. Temporal Activities（2025-11-11 完了）
   - `runSecurityGate` / `runJudgePanel` / `recordHumanDecisionMetadata` で `sandbox-runner/artifacts/<revision>/metadata.json` の `wandbMcp.stages` を更新し、サマリ・Ledgerダイジェスト・LLM設定・Human決裁メモをRunに同期する。

## 4. 実装ステップ
1. Submission APIへRun情報フィールド追加。DB/イベントスキーマを更新。（済）
2. Temporal Workflow入力 (`ReviewPipelineInput`) に `wandbRun` セクションを追加し、`progressQuery` でも返す。（済）
3. Sandbox Runner CLIへ `--wandb-run-id` 等の引数追加・`init_wandb_run` の上書きロジック実装。（済）
4. Inspect WorkerにW&Bラッパーを導入し、Judge成果物をRunにアタッチ。（済）
5. Human Review REST API/UIにRun URL＋Ledger表示＋決裁ログ連携を追加。次フェーズではRun ID自動払い出しと操作履歴アップロードを行う。

## 5. 今後のフォローアップ
- SubmissionでRun ID省略時にTemporal側でUUIDを払い出し、`metadata.json` / W&B Run双方へ記録する。
- Human Review決裁時にW&Bへカスタムイベント（例: `human/decision`) を送信し、UIと同じ情報をダッシュボードの履歴でも確認できるようにする。
- `/review/ledger` のレスポンスに `workflowRunId` / `generatedAt` を含め、複数回の審査が行われた場合でもLedgerを切り分けられるようにする。
