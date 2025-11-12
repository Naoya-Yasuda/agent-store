# Security Gate Ledger 連携メモ (ドラフト)

## 1. 目的
- Security Gate（AdvBench攻撃ステージ）のサマリをAudit Ledgerへ記録し、後から第三者が審査内容を検証できるようにする。
- Temporal Workflow / CLI / W&B で生成されたカテゴリ統計・攻撃テンプレをLedgerにも残し、監査用ハッシュチェーンの一部に組み込む。

## 2. 記録内容（Security + Judge）
| フィールド | 説明 |
| --- | --- |
| `workflowId` / `runId` | Temporal WorkflowのID・Run ID。既存Ledgerスキーマに合わせる。|
| `stage` | `security` / `functional` / `judge` などステージ名。|
| `summaryDigest` | 各ステージの `*_summary.json` のSHA256。実ファイルはArtifactsに残し、Ledgerにはハッシュのみ保持。|
| `reportDigest` | `security_report.jsonl` / `functional_report.jsonl` / `judge_report.jsonl` のSHA256。|
| `promptsPath` / `promptsDigest` | `security_prompts.jsonl` / `functional_scenarios.jsonl` のパスとハッシュ。|
| `metrics` | ステージ固有メトリクス（Securityカテゴリ件数、Functionalの平均距離、Judgeのverdict件数など）。|
| `timestamp` | サマリ生成時刻 (`generatedAt`) 。|

Functional Accuracyの場合は、RAGTruth突合の `functional_summary.json` / `functional_report.jsonl` / `functional_scenarios.jsonl` を対象に、Embedding距離や `needsReview` 件数をLedgerに残す。Judge Panelの場合は `judge_summary.json` / `judge_report.jsonl` / `relay_logs.jsonl` のハッシュ、`llmVerdict` 件数、LLM設定（provider/model/temperature/dryRun）を含める。

## 3. 実装ポイント
1. **Sandbox Runner**
   - 既存の `security_summary.json` に `categories`, `promptsArtifact`, `endpointFailures`, `timeoutFailures` を記録済み。Ledger用にはSHA256を計算し、Temporalへ返す値に含める。
2. **Temporal Activities**
   - `runSecurityGate` の戻り値に `ledgerEntry` 的なフィールド（summary path + digest）を追加し、Workflowが完了したタイミングでAudit LedgerへPOSTするアクティビティを挟む。
   - Functional Accuracyも `runFunctionalAccuracy` 内で `recordFunctionalLedger` を呼び、`functional_summary.json` / `functional_report.jsonl` / `functional_scenarios.jsonl` のハッシュとEmbedding距離などをLedgerに出力する。
   - Judge Panelも同一パターンで `runJudgePanel` から `recordJudgeLedger` を呼び、`judge_summary.json` / `judge_report.jsonl` / `relay_logs.jsonl` のハッシュとLLM設定・判定件数をLedgerへ書き込む。
3. **Auditライブラリ**
   - 既存の `publishToLedger` ヘルパーを再利用し、`securityLedgerEntry.json` を自動生成。オプションでHTTP送信。
4. **W&B & UI**
   - LedgerエントリのURL/ハッシュをWorkflow Progressに含め、Human Review UIやW&B Runから辿れるようにする。
   - Judgeステージも同様にLedger情報を進捗detailsに含め、UIでリンク表示する。

## 4. Functional / Judge 拡張
### Functional Accuracy
1. RAGTruthシナリオ (`functional_scenarios.jsonl`) と `functional_report.jsonl` をArtifactsに保持し、Ledgerにはハッシュと相対パスのみ保存する。
2. Ledgerエントリには `metrics` として平均距離・Embedding距離・`needsReview` 件数を格納し、再実行時に比較できるようにする。
3. Ledger出力先は `FUNCTIONAL_LEDGER_DIR` / `FUNCTIONAL_LEDGER_ENDPOINT` / `FUNCTIONAL_LEDGER_TOKEN` を優先し、未設定の場合はSecurityの環境変数を再利用する。

### Judge Panel
1. Attackテンプレ同様に、Judgeの `judge_report.jsonl` / `relay_logs.jsonl` をArtifactsに保持し、Ledgerにはハッシュのみ保存。実応答やLLM説明は審査専用データのためフルで残して問題ない。
2. Ledgerエントリには `llmConfig`（enabled, provider, model, temperature, dryRun）と `llmVerdictCounts` を含める。これにより再現性と監査性を保証する。
3. Human Review UIの再実行フォームは前回のLLM設定をデフォルトで引き継ぎ、必要に応じて上書きできるようにする（設定を毎回入力させない）。

## 5. 運用フロー
1. Security Gate実行 → サマリ/テンプレ/レポート生成。
2. Temporal `runSecurityGate` 完了後、`recordSecurityLedger` がpayload JSONを生成し`publishToLedger`を呼び出す。
3. Judge Panel完了時も `recordJudgeLedger` が同様のpayloadを生成する。`JUDGE_LEDGER_*` が未設定で `SECURITY_LEDGER_*` のみ指定されている場合は同じLedgerディレクトリ/エンドポイントを再利用できる。
4. Workflow Progress (`queryProgress`) の `details.ledger` にエントリパスとダイジェストを格納し、Human Review UIやAPIレスポンスから辿れるようにする。
5. 監査時はTemporal History + Ledgerエントリ + Artifactsを突合。

## 6. 今後の課題
- Ledgerスキーマのバージョン管理（Security/Functional/Judgeで共通化）。
- 非公開情報（攻撃テンプレ）をどこまでLedgerに載せるか。デフォルトはハッシュのみ。
- 失敗時のリトライ戦略（Ledger APIがダウンしている場合の扱い）。

## 7. 実装状況 (2025-11-11)
- Security Gate: `recordSecurityLedger` が `security_ledger_entry.json` を生成し、`SECURITY_LEDGER_*` に基づいてLedgerへ保存/POSTする。Vitest (`src/__tests__/ledger.test.ts`) でハッシュ生成とファイル出力をカバー済み。
- Functional Accuracy: `recordFunctionalLedger` が `functional_summary.json` / `functional_report.jsonl` / `functional_scenarios.jsonl` のハッシュとEmbedding距離メトリクスを `functional_ledger_entry.json` に書き出し、`FUNCTIONAL_LEDGER_*`（未設定時はSecurity用変数を再利用）でLedgerへ転送。Workflow progressとHuman Review UIのFunctionalステージ details にLedgerダイジェストを表示。
- Judge Panel: Inspect Worker CLI実行後に `recordJudgeLedger` が summary/report/relayログのSHA256とLLM設定（`llmJudge`）、判定件数（approved/manual/rejected）、Relayエラー件数をまとめたpayloadを `judge_ledger_entry.json` として書き出し、`JUDGE_LEDGER_*`（未設定時はSecurity用変数を再利用）でLedgerへ転送する。
- Workflow: `reviewPipeline.workflow.ts` のステージ details に Ledgerパス/ダイジェストを含め、Human Review UIとW&Bから参照できるようにした。
- Ledgerのエントリパスに加えて、原本 (`sandbox-runner/artifacts/<rev>/<stage>_ledger_entry.json`) への `sourceFile` をStage Metadataに保持し、`/review/ledger/download` がローカルLedger欠損時にFallback配信できるようにした。
- Pending: Ledger API障害時のリトライ/警告UI出力。
- Update (2025-11-12): `publishToLedger` はHTTP送信を最大3回リトライし、失敗してもワークフローを止めずに `httpPosted=false` / `httpAttempts` / `httpError` をStage detailsへ書き込みます。Human Review UI・`/review/ledger` API・W&Bメタデータは同フラグを表示するため、Ledger障害を即座に検知できます。
- Update (2025-11-12): `/review/ui/:id` では `getLedgerSummary` ベースでローカルLedgerファイルの存在確認を行い、`/review/ledger/download` が返せない（削除・パーミッション喪失）場合は「ダウンロード: 不可」と赤枠で通知します。Fallbackファイルが存在する場合はそのパスを表示し、監査担当が即座に復旧経路を辿れるようにしました。
