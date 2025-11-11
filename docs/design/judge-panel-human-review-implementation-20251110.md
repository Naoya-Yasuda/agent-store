# Judge Panel & Human Review 実装メモ (2025-11-10)

## 1. ゴール
- `prototype/inspect-worker/` で Google ADK ベースの Judge Orchestrator（質問生成→実行→MCTS-Judge）を再現し、Sandbox Runnerの成果物だけでなく A2A Relay 経由の再評価も扱えるようにする。
- Temporal ワークフローの `JudgePanel` ステージと `HumanReview` ステージを Inspect Worker / UI と疎結合に接続する。
- Human Review UI では観点別の証拠（質問・回答・判定理由・添付アーティファクト）を時系列で表示し、`signalRetryStage`/`queryProgress` を使った再実行操作を提供する。

## 2. 現状整理
- Sandbox Runner は `response_samples.jsonl` と Security Gate/Functional Accuracy のレポートを生成済み。Inspect Worker側の `scripts/run_eval.py` も質問生成→Relay実行→MCTS-Judge→LLM判定の実装が入り、`judge_report.jsonl` / `judge_summary.json` / `relay_logs.jsonl` を安定的に出力できるようになった。
- Temporal ワークフロー (`prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts`) は `runJudgePanel` アクティビティでInspect Worker CLIを実行し、Ledger記録（`recordJudgeLedger`）まで自動化。Human Review ステージは引き続きモックで、UI経由の承認/差戻し、再実行リクエストの反映は未実装。
- UI はNext.js版/HTML版ともに最低限の進捗ビューのみだったが、2025-11-11 時点で Judge セクションに `llmScore`/`llmVerdict` カード表示と Relay JSONL ログの整形プレビューを追加済み。Ledgerリンクや再実行フォームからのLLM設定保持は追加済みだが、Human Review決裁APIとの完全連携は未実装。
- 2025-11-11 時点で、LLM-as-a-Judge レイヤーは追加済みで、`judge_report.jsonl` にLLMスコアや判定理由を保存し、W&Bにも主要メトリクスを送信する。審査証跡（LLM設定・verdict内訳）をW&Bメタデータへ反映する処理と、UIでの可視化はこれから着手する。
  - Temporalアクティビティから `sandbox-runner/artifacts/<rev>/metadata.json` の `judgePanel` / `wandbMcp.stages.judge` を更新し、`queryProgress`で返るLLM情報とW&Bのメタデータを同期済み。

## 3. Inspect Worker（Judge Panel）要件
1. **Question Generator**
   - 入力: AgentCard `capabilities`/`useCases`、Security/Functional結果、`prompts/aisi/` の観点定義。 
   - 出力: 観点→質問テンプレ→期待回答（NLIでCardとの差分チェック）。
   - 実装: `prototype/inspect-worker/src/question_generator.py` (新規) で Google ADK風プロンプトチェーンを構築。
2. **Execution Agent**
   - 入力質問をA2A Relay経由で提出エージェントに送信（`sandbox_runner`で使うRelay情報と共通化）。
   - 最大3回まで自動リトライし、HTTP 4xx/5xxやURLErrorをエラー履歴として収集。レスポンス全文とスニペット、禁止語（パスワード/APIキー/SSN/秘密鍵など）の検知結果を `relay_logs.jsonl` / `judge_report.jsonl` に保存する。
   - 呼び出しはasync/同期いずれも可だが、Temporal上はアクティビティとして分割してリトライ可能にする。
3. **Panel Judge (MCTS)**
   - 少なくとも3つのLLM（例: Gemini 1.5 Pro, GPT-4o, Claude 3.5）を並列実行し、Verdict + Rationaleを収集。
   - MCTS-Judge: 段階（主張→反証→再評価→集約→メタチェック）をコード化し、矛盾があれば`verdict=manual`、即NGなら`verdict=reject`。
   - 2025-11-11 時点で、Inspect Worker に外部LLM (OpenAI) を判定レイヤーとして組み込むPoCを追加済み。資格情報が無い場合は `--judge-llm-dry-run` でMCTSヒューリスティックのみを使用する。
4. **Artifacts**
   - `prototype/inspect-worker/out/<agent>/<revision>/judge_report.jsonl`（質問単位）と`judge_summary.json`（観点別スコア）。
   - 各質問IDには `securityGate` / `functionalAccuracy` からの証拠リンク、A2Aログ、LLM判定理由を含める。Relayログ/LLM説明は審査専用データとしてフル保存し、Ledgerにはハッシュを記録する。
5. **Temporal フック**
   - `runJudgePanel` アクティビティは Inspect Worker をCLIまたはPython APIで呼び、`{ verdict, score, explanation, artifacts }` を返す。
   - しきい値/矛盾の場合は `signalRetryStage('judge', reason)` を送るための情報をHuman Review UIへ渡す。Ledger向けのハッシュ/パス情報も返し、Securityステージ同様に記録する。

## 4. Human Review UI 要件
1. **進捗バー + ステージログ**
   - `queryProgress()` のレスポンス（stage status, attempts, warnings）をAPI経由で取得し、PreCheck→Security→Functional→Judge→Human→Publishを視覚化。
2. **証拠閲覧**
   - Security/Functional/JudgeのレポートJSONを表示（`security_report.jsonl`, `functional_report.jsonl`, `judge_report.jsonl` など）。
   - 各レコードに観点タグ、質問、Agent回答、LLM判定、必要な再試行理由を添付。
3. **操作**
   - `signalRetryStage(stage, reason)` を発火するボタン（例: Security再実行、Judge再実行）。Judge再実行フォームは前回のLLM設定をデフォルトで引き継ぎ、必要に応じて上書きできるようにする。
   - Human Reviewの承認/差戻しでTemporal `HumanReview` ステージを完了させる（REST API: `/review/human/decision` などを想定）。
4. **監査トレイル**
   - W&B MCPのRun URL、Audit Ledgerのエントリ、ArtifactへのS3/Filesystemリンクを表示。
   - 操作ログ（誰がいつ承認/差戻ししたか）を`statusReason`や`AgentEndpointAttestations`と同期。

## 5. 実装ブレークダウン
- **Inspect Worker**
  - `src/agents/question_generator.py`、`src/agents/execution_agent.py`、`src/agents/judge_orchestrator.py` を新設。
  - CLI (`scripts/run_eval.py`) に `--attack-endpoint`, `--judge-config` などのフラグを追加し、Sandbox Runner成果物＋A2A接続情報を受け取る。
  - W&B MCPとの連携: JudgeレポートをArtifactsとしてアップロードするHookを追加。
- **W&Bメトリクス**
  - `judge/questions`, `judge/approved`, `judge/manual`, `judge/rejected`, `judge/flagged`, `judge/llm_calls`, `judge/relay_errors` を出力し、QAトレースとプロセス健全性を可視化。
- **Temporal Activities**
  - `prototype/temporal-review-workflow/src/activities/index.ts` で `runJudgePanel` がInspect Worker CLIを実行し、`recordJudgeLedger` によって summary/report/relayログのハッシュ＋LLM設定をLedgerへPOST。Security Gate同様に `details.ledger` を`queryProgress`へ返す。
  - Human Reviewの決定結果（承認/差戻し）は `signalHumanDecision` を通じてWorkflowへ伝搬し、`escalateToHuman` がシグナルを待ってHumanステージ/Terminal Stateを更新する（APIは `/review/decision` → `sendHumanDecision` → Temporal Signal という経路）。
- **UI/API**
  - `api/routes/reviews.ts` (新規) でHuman Review用のREST API（進捗取得、証拠取得、再実行リクエスト、承認/差戻し）を提供。
  - フロントエンド（別リポジトリ想定）の要件として、観点フィルタ・差戻し理由入力・W&Bリンク表示を記述。

## 6. リスク / 未決事項
- LLMコストとデータ取り扱いポリシー（提出エージェントのプロンプト/回答を外部LLMに渡す際のマスキング）。
- A2A Relayのレート制御と、Judge Panel実行中の並列数制限。
- Human Review UIのユーザー管理（RBAC）と監査ログ連携。

## 7. 次ステップ (2025-11-11)
1. **LLM Override Validation**: Judge再実行フォームから送られたLLM設定がTemporal→Inspect Workerまで到達することをVitest/E2Eで確認し、READMEに利用手順・注意点を追記。数値入力（temperature/maxTokens）の範囲・フォーマットをUIでバリデーションする。
2. **W&B Event Logging**: `recordStageEvent` → `sandbox_runner.log_wandb_event` をJudge manual判定やLLM override通知にも適用し、W&Bダッシュボードのタイムラインに全処理イベント（再実行・決裁）を記録する（2025-11-11 実装）。
3. **Relay UX改善**: Relayログ検索フィルタの追加、禁止語ヒット専用ビュー、JSONLダウンロードボタンなどHuman Review UIでの検証体験を改善する。
4. **回帰テスト拡充**: Temporal/VitestでLLM override／W&Bイベントをモック検証。UIはReact Testing Library等でフォームバリデーションやエラー表示をテストする。
