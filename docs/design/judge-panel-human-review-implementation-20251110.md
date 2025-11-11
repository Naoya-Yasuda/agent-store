# Judge Panel & Human Review 実装メモ (2025-11-10)

## 1. ゴール
- `prototype/inspect-worker/` で Google ADK ベースの Judge Orchestrator（質問生成→実行→MCTS-Judge）を再現し、Sandbox Runnerの成果物だけでなく A2A Relay 経由の再評価も扱えるようにする。
- Temporal ワークフローの `JudgePanel` ステージと `HumanReview` ステージを Inspect Worker / UI と疎結合に接続する。
- Human Review UI では観点別の証拠（質問・回答・判定理由・添付アーティファクト）を時系列で表示し、`signalRetryStage`/`queryProgress` を使った再実行操作を提供する。

## 2. 現状整理
- Sandbox Runner は `response_samples.jsonl` と Security Gate/Functional Accuracy のレポートを生成済みだが、Judge Panel はまだプレースホルダー実装（`prototype/inspect-worker/scripts/run_eval.py` がInspectの placeholder 実行に依存）。
- Temporal ワークフロー (`prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts`) では `runJudgePanel` アクティビティがダミー値を返し、Human Review ステージも `notifyHumanReview` のモックを呼ぶだけ。
- UI は未実装のため、レビュワーは`prototype/inspect-worker/out/<agent>/<revision>/summary.json`などを直接参照する必要がある。

## 3. Inspect Worker（Judge Panel）要件
1. **Question Generator**
   - 入力: AgentCard `capabilities`/`useCases`、Security/Functional結果、`prompts/aisi/` の観点定義。 
   - 出力: 観点→質問テンプレ→期待回答（NLIでCardとの差分チェック）。
   - 実装: `prototype/inspect-worker/src/question_generator.py` (新規) で Google ADK風プロンプトチェーンを構築。
2. **Execution Agent**
   - 入力質問をA2A Relay経由で提出エージェントに送信（`sandbox_runner`で使うRelay情報と共通化）。
   - 呼び出しはasync/同期いずれも可だが、Temporal上はアクティビティとして分割してリトライ可能にする。
3. **Panel Judge (MCTS)**
   - 少なくとも3つのLLM（例: Gemini 1.5 Pro, GPT-4o, Claude 3.5）を並列実行し、Verdict + Rationaleを収集。
   - MCTS-Judge: 段階（主張→反証→再評価→集約→メタチェック）をコード化し、矛盾があれば`verdict=manual`、即NGなら`verdict=reject`。
   - 2025-11-11 時点で、Inspect Worker に外部LLM (OpenAI) を判定レイヤーとして組み込むPoCを追加済み。資格情報が無い場合は `--judge-llm-dry-run` でMCTSヒューリスティックのみを使用する。
4. **Artifacts**
   - `prototype/inspect-worker/out/<agent>/<revision>/judge_report.jsonl`（質問単位）と`judge_summary.json`（観点別スコア）。
   - 各質問IDには `securityGate` / `functionalAccuracy` からの証拠リンク、A2Aログ、LLM判定理由を含める。
5. **Temporal フック**
   - `runJudgePanel` アクティビティは Inspect Worker をCLIまたはPython APIで呼び、`{ verdict, score, explanation, artifacts }` を返す。
   - しきい値/矛盾の場合は `signalRetryStage('judge', reason)` を送るための情報をHuman Review UIへ渡す。

## 4. Human Review UI 要件
1. **進捗バー + ステージログ**
   - `queryProgress()` のレスポンス（stage status, attempts, warnings）をAPI経由で取得し、PreCheck→Security→Functional→Judge→Human→Publishを視覚化。
2. **証拠閲覧**
   - Security/Functional/JudgeのレポートJSONを表示（`security_report.jsonl`, `functional_report.jsonl`, `judge_report.jsonl` など）。
   - 各レコードに観点タグ、質問、Agent回答、LLM判定、必要な再試行理由を添付。
3. **操作**
   - `signalRetryStage(stage, reason)` を発火するボタン（例: Security再実行、Judge再実行）。
   - Human Reviewの承認/差戻しでTemporal `HumanReview` ステージを完了させる（REST API: `/review/human/decision` などを想定）。
4. **監査トレイル**
   - W&B MCPのRun URL、Audit Ledgerのエントリ、ArtifactへのS3/Filesystemリンクを表示。
   - 操作ログ（誰がいつ承認/差戻ししたか）を`statusReason`や`AgentEndpointAttestations`と同期。

## 5. 実装ブレークダウン
- **Inspect Worker**
  - `src/agents/question_generator.py`、`src/agents/execution_agent.py`、`src/agents/judge_orchestrator.py` を新設。
  - CLI (`scripts/run_eval.py`) に `--attack-endpoint`, `--judge-config` などのフラグを追加し、Sandbox Runner成果物＋A2A接続情報を受け取る。
  - W&B MCPとの連携: JudgeレポートをArtifactsとしてアップロードするHookを追加。
- **Temporal Activities**
  - `prototype/temporal-review-workflow/src/activities/index.ts` に `runJudgePanel`/`notifyHumanReview` の実装を追加し、Inspect Worker CLIを叩く。
  - Human Reviewの決定結果（承認/差戻し）をAPI経由で受け取り、`signalRetryStage`や`terminalState`に反映。
- **UI/API**
  - `api/routes/reviews.ts` (新規) でHuman Review用のREST API（進捗取得、証拠取得、再実行リクエスト、承認/差戻し）を提供。
  - フロントエンド（別リポジトリ想定）の要件として、観点フィルタ・差戻し理由入力・W&Bリンク表示を記述。

## 6. リスク / 未決事項
- LLMコストとデータ取り扱いポリシー（提出エージェントのプロンプト/回答を外部LLMに渡す際のマスキング）。
- A2A Relayのレート制御と、Judge Panel実行中の並列数制限。
- Human Review UIのユーザー管理（RBAC）と監査ログ連携。

## 7. 次ステップ
1. Inspect WorkerにQuestion Generator / Execution / Judge Orchestratorの骨組みを追加し、ダミーでもCLI経由で呼べるようにする。
2. Temporal activitiesを更新して実際のCLIを呼び出し、結果を`runJudgePanel`に反映。
3. Human Review API（バックエンド）と簡易UI（最低限の進捗表示＋承認/差戻し）を実装。
