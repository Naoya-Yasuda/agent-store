# レビューア向けチェックリスト（Functional Accuracy & Judge Panel）

## 背景
Temporal ワークフロー（`prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts`）では、Security Gate → Functional Accuracy → Judge Panel を連続して実行し、最後に必要であれば人間レビューが入る構成です。Functional Accuracy と Judge Panel はどちらも Google ADK を使った「評価エージェント」層ですが役割が異なるため、Review UI（`http://localhost:3001/review/ui` 相当）では以下の観点を明示的に確認できるようにします。本設計書はそのチェックポイントを整理し、実装/UI 表示に落とし込むための要件とします。

## 1. Functional Accuracy でレビューすべきこと

1. **シナリオと期待値の網羅性**
   - AgentCard 由来のユースケース（`sandbox-runner/src/sandbox_runner/functional_accuracy.py` の `generate_scenarios`）と、AdvBench（AISI/aisev 由来の汎用質問）で構築されたシナリオ両方を確認する。
   - `functional_scenarios.jsonl` または UI 上の一覧で prompt/use_case/expected_answer の列が表示されていること。
2. **評価結果の意味的構造**
   - 各シナリオで `AgentResponseEvaluator.evaluate_response` が出力する `verdict`/`topic_relevance`/`dialogue_progress`/`errors` をレビュアが一目で把握できるようにする。
   - `needs_review` や `fail` となった理由が、JSON `rationale` で説明されているか確認する。
3. **AdvBench の存在確認**
   - CLI の `--advbench-dir`（デフォルト `third_party/aisev/backend/dataset/output`）で読み込まれる AdvBench CSV から最大 20 件程度を取り込み、AdvBench 特有の `ten_perspective`/`requirement` に基づく汎用質問が Functional Accuracy レポートに現れているか検証する。
   - AdvBench の汎用質問でも `expected_answer` が RAGTruth（`resources/ragtruth`）とマッチしているか（`attach_expected_answers` による `similarity`）を確認し、期待値が設定されていない場合は manual entry/補足を検討する。
4. **定量指標と距離**
   - `functional_report.jsonl` の各レコードに `distance`/`embeddingDistance` が記録されているので、平均距離や最大距離が既定の閾値を超えていないかをチェック。
   - `embedding_distance`（`run_functional_accuracy` 内で計算）も UI に出して傾向を確認する。
5. **AdvBench と AgentCard の差分**
   - Functional Accuracy 上では AgentCard のユースケースと AdvBench の汎用質問の結果が混在するため、UI で「AgentCard由来」「AdvBench由来」などのタグ表示やフィルタを導入し、レビュアがどちらの観点で失敗/成功したかを区別できるようにする。

## 2. Judge Panel でレビューすべきこと

1. **Question Generator と Execution Agent の流れ**
   - `prototype/inspect-worker/inspect_worker/question_generator.py` で AgentCard から生成される質問を確認し、Question ID/意図/期待動作が正確かどうかを記録。
   - Execution Agent が A2A Relay 経由で提出エージェントに何を投げたか（`relay_logs.jsonl`）を UI で参照できるようにし、対話履歴が残っているか確認する。
2. **LLM Judge（マルチモデル）の判定**
   - `prototype/inspect-worker/inspect_worker/llm_judge.py` にある JSON 出力（`task_completion`/`tool_usage`/`autonomy`/`safety`/`total_score`/`verdict`/`reasoning`）を UI に表示し、複数モデルのスコアを比較する。
   - `provider=google-adk` がデフォルトだが、複数モデル（GPT/Claude/Gemini）でパネルを構成した場合は minority-veto の発動履歴や `verdict` のばらつきを可視化する。
3. **少数派・手動レビュートリガー**
   - Judge Panel が `verdict=manual` や `reject` を出した場合、自動判定の根拠（何が不足していたか）を `reasoning` で記録するとともに、Human Review へのリンク（`notifyHumanReview` で生成された URL）を UI に設置する。
   - `minority-veto` 戦略により 30%以上が `reject` を出していれば `manual` フラグを立てる設計があるため、モデルごとの `confidence`/`score` を一覧化し、異常な分散がないかをチェックする。
4. **AgentCard 以外の質問の扱い**
   - Judge Panel で使用される質問が必ずしも AgentCard 由来ではない場合（AdvBench や手動追加）、その provenance を UI で示すことでレビュアが AISI 観点か固有観点かを判断できるようにする。
   - Judge Panel のアウトプット（`judge_report.jsonl`）に `source` フィールドを含めるか、UI 側で `QuestionSpec.source` を表示すると透明性が高まる。
5. **Human Review への引数/Artifacts**
   - Judge Panel の `trigger` で Human Review にエスカレーションされた時は、`relayLogPath`/`reportPath`/`summaryPath` を添付し、レビュアが何を確認すべきか（回答の矛盾、セキュリティ違反、ツール使用の不備など）をダッシュボードに提示する。

## 3. 次にやること（実装スタートのための TODO）

1. `http://localhost:3001/review/ui` に「Functional Accuracy」「Judge Panel」のタブを追加し、本チェックリストの観点を一つ一つ UI コンポーネントで表示する（各ステージの JSON/artifact へのリンクを貼る）。  
2. AdvBench/AgentCard のシナリオ別にタグ付け・フィルタリングを実装し、レビュアが特定の観点だけを抽出できるようにする。  
3. Judge Panel の `reasoning`・`score` を適切にパーサーして UI へ渡すバックエンド（Inspect Worker／API）を補強する。  
4. この設計書を基にレビュー時に見るべきカラム・ログ・リンクを整理したドキュメント（README/Manual）を並行して整備し、運用手順と一致させる。  
5. AdvBench/Functional Accuracy の結果が `needs_review`/`fail` だった時に Human Review に自動通知するエンドポイントの責任者と連携する。
