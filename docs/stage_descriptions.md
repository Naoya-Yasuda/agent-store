# 審査ステージ別の役割と実装概要

以下のドキュメントは現在のコードベース（`prototype/temporal-review-workflow/src/...`、`prototype/inspect-worker/...`、`sandbox-runner/...` など）に基づき、各ステージが何をしているかを整理したものです。各ステージの実装箇所も併記し、レビュー／登録者／運用者が把握しやすいようにしています。

## 1. PreCheck
- **何をするか**: 提出された Agent（`submissionId`）の基本情報を DB から取得し、AgentCard／revision／提出者権限などを検証。欠落や不整合があれば拒否し、warnings を記録。
- **主な処理**: `prototype/temporal-review-workflow/src/activities/index.ts` の `preCheckSubmission`（`reviewService.getWorkflowProgress` など）で `submissionId`/`agentRevisionId` をセットし、`reviewPipeline` ワークフローの context を初期化。
- **出力**: `context.agentId` / `context.agentRevisionId` を設定し、`progress.stages.precheck` に warnings を追加。

## 2. Security Gate (AdvBench攻撃・ガードレール検証)
- **何をするか**: AdvBench＋ルールベースの攻撃テンプレートを提出エージェントに実行し、セキュリティ上の脆弱性（禁止語／レスポンス違反）を検出。AdvBench のプロンプトは“実際の攻撃”として送信されるので、攻撃/応答のやり取りも実エージェントとの通信ログ（`relay_logs.jsonl`、`security_prompts.jsonl`）として保存される。
- **主な処理**: `sandbox-runner` の `scripts/run_inspect_flow.sh` よりも前の `sandbox-runner.cli run_security_gate`。`prototype/inspect-worker/scripts/run_eval.py` で AdvBench の CSV（`third_party/aisev/backend/dataset/output`）を読み込み、`security_report.jsonl`/`security_summary.json`/`security_prompts.jsonl` を生成。`api/routes/reviews.ts` の `/review/artifacts/...` でこれらを提供。
- **出力**: `security_summary.json`、`security_report.jsonl`、警告・fail レベルを `functional` への gate でチェック。`reviewPipeline` で `failReasons` があれば `security` stage の status を `failed` に。

## 3. Functional Accuracy (意図・機能検証)
- **何をするか**: AgentCard の `useCases` と AdvBench（AISI/aisev）の質問を合わせて最大 約 10 件のシナリオを評価し、各問いに対して Google ADK（またはトークン類似度）で `topic_relevance`・`dialogue_progress`・`distance` を測定することで `pass/needs_review/fail` を決定します。Functional Accuracy は「機能的な性能／文脈的な整合性」を見るステージであり、Security Gate が攻撃に耐えるかを見るのとは目的が異なります。AdvBench も Security Gate と共有する素材ですが、Functional Accuracy は「期待された対応をどれだけ忠実に行ったか」を定量化します。
- **審査の観点**: 「この質問に対する応答は所定の意図を捉えているか」「必要な追加情報や確認の質問が出ているか」「回答に誤りやハルシネーションがないか」を可視化して、Human Review に送るべき `needs_review`/`fail` をあらかじめ絞り込みます。
- **主な処理**: `sandbox-runner/src/sandbox_runner/functional_accuracy.py` の `run_functional_accuracy` で AgentCard + AdvBench から `Scenario` を作成し、`AgentResponseEvaluator` が multi-stage evaluation を回して `functional_report.jsonl`・`functional_summary.json` を生成。結果は `prototype/temporal-review-workflow/src/activities/index.ts` の `runFunctionalAccuracy` で `reviewPipeline` に取り込まれます（CLI に `--advbench-dir/--advbench-limit` を渡す設定あり）。
- **出力**: `functional_report.jsonl`（prompt/response/verdict）・`functional_summary.json`（metrics、advbenchScenarios、avgDistance）・`functional_scenarios.jsonl`。Review UI では `/stage/functional` でこれらを読み込んでテーブル・chart・failure セクションを表示し、AdvBench/AgentCard 両方の視点で pass/needs_review/fail を確認できます。

## 4. Judge Panel
- **何をするか**: AgentCard／AdvBench 由来の質問を Question Generator で作り、Execution Agent でエージェントに投げた回答を複数エージェントに同時評価させます。各 LLM（Google ADK、openai/claude 等）は `task_completion`/`tool_usage`/`autonomy`/`safety` と `verdict` を返し、それらを MCTS（`panel_judge.py`）の論理ツリーで合意形成して aggregated verdict を決定。質問数のデフォルトは `--judge-max-questions`／`JUDGE_MAX_QUESTIONS=5`（`question_generator` 最大 5 件）ですが、CLI オプションや環境変数で増やすこともできます。
- **審査のイメージ**: 「複数モデルがどう評価したかを並べて、少数派 veto（30%以上 reject/flagged）や manual 判定の原因を可視化」「Judge Report に rationale を残し、矛盾があるときは Human Review へ回す」ためのステージです。
- **主な処理**:
  - `prototype/inspect-worker/inspect_worker/question_generator.py`: AgentCard から質問と `expected_behaviour` を生成（AdvBench も併用）。
  - `prototype/inspect-worker/inspect_worker/execution_agent.py`: A2A Relay でエージェントと通信し、`relay_logs.jsonl` を生成。
  - `prototype/inspect-worker/inspect_worker/llm_judge.py`, `panel_judge.py`, `judge_orchestrator.py`: 「Task/Tool/Autonomy/Safety」軸でスコアし、minority veto を含む MCTS を回す。結果は `judge_report.jsonl`/`judge_summary.json` に出力。
  - `prototype/temporal-review-workflow/src/activities/runJudgePanel`: Inspect CLI を呼び `judge_summary.json` を `stageDetails` に保存。
- **出力**: `judge_report.jsonl`·`judge_summary.json`·`relay_logs.jsonl`·`Judge Panel` stage status/verdict。Judge UI は `/stage/judge` でそれらを表示。

## 5. Human Review
- **何をするか**: Judge Panel が `manual` や `flagged` を出したケースを人間オペレータがレビュー。UI で追加コメント・マニュアル再実行を受け付け、最終決定を記録。
- **主な処理**: `prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts` で `notifyHumanReview` を呼び、`api/routes/reviews.ts` の `/review/decision` でレビュアの判断（approved/rejected）を記録。`TrustScore`・ledger にも記録する。
- **出力**: `stage=human` の summary/ledger entry。`review(ui)` では Human Review セクションに `decision`/`notes` を表示。

## 6. Publish
- **何をするか**: 全ステージを通過したエージェントを公開。Trust Score を計算し、`publishAgent` で `published_at` を記録。
- **主な処理**: `reviewPipeline` の最後で `publishAgent` を呼び、`api/routes/reviews.ts` の `publishAgent` で DB に status を保存。Human Review で “approved” になったものが対象。
- **出力**: `stage=publish` の status、Trust Score、ledger entry（`recordFunctionalLedger`/`recordJudgeLedger` の hash）。`review/ui` の Trust Score Card に反映。

以上の段階が `prototype/temporal-review-workflow`／`sandbox-runner`／`inspect-worker` に実装されています。必要であればこのドキュメントを README でも参照可能にリンクすることもできますので、希望があれば追記します。
