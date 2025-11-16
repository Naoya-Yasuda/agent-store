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
- **何をするか**: AgentCard（useCases）および AdvBench（AISI/aisev）シナリオに対して、Google ADK もしくはトークン類似度でレスポンスを評価し、topic＝意図、dialogue＝進行、distance＝一致度を測る。機能確認（Functional）とセキュリティ攻撃（Security Gate）は手段が異なり、Functional Accuracy は「期待されたユースケースに沿って意味的に整っているか」を見て、Security Gateは「悪意のある入力に対して安全か」を調べ、どちらも AdvBench を共通の素材として使っています。デフォルトでは AgentCard＋AdvBench あわせて **10件のシナリオ**を評価します（`--functional-max-scenarios` または `sandbox-runner` CLI の `functional_max_scenarios` 設定で変更可）。
- **主な処理**: `sandbox-runner/src/sandbox_runner/functional_accuracy.py` の `run_functional_accuracy`。AgentCard から `Scenario` を生成し、`load_advbench_scenarios` を通じて AdvBench 入力を追加。`AgentResponseEvaluator` が `google.adk.agents.Agent` を使い multi-stage evaluation を実行。`functional_report.jsonl` （prompt/response/verdict）と `functional_summary.json`（metrics、advbenchScenarios）を生成。`prototype/temporal-review-workflow/src/activities/index.ts` の `runFunctionalAccuracy` で CLI を呼び `artifacts` を `reviewPipeline` に取り込み。
- **出力**: `functional_report.jsonl`、`functional_summary.json`、`functional_scenarios.jsonl`。UI では `/stage/functional` でこれらを表として表示し、AdvBench / pass/needs_review/fail を分類。

## 4. Judge Panel
- **何をするか**: AgentCard／AdvBench の質問を生成し、Execution Agent→LLM Judge（Google ADK + multi-model panel）で多角的にスコア。MCTS（`panel_judge.py`）で各モデル verdict を集約し、Manual/Reject のトリガーを判断。質問数のデフォルトは `--judge-max-questions`／`JUDGE_MAX_QUESTIONS=5`（`question_generator` も最大 5 件）で、必要に応じて CLI/環境変数で増やせます。
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
