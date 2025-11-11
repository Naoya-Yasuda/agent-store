# Security Gate Ledger 連携メモ (ドラフト)

## 1. 目的
- Security Gate（AdvBench攻撃ステージ）のサマリをAudit Ledgerへ記録し、後から第三者が審査内容を検証できるようにする。
- Temporal Workflow / CLI / W&B で生成されたカテゴリ統計・攻撃テンプレをLedgerにも残し、監査用ハッシュチェーンの一部に組み込む。

## 2. 記録内容
| フィールド | 説明 |
| --- | --- |
| `workflowId` / `runId` | Temporal WorkflowのID・Run ID。既存Ledgerスキーマに合わせる。|
| `stage` | `security` 固定。今後Functional/Judgeにも拡張予定。|
| `summaryDigest` | `security_summary.json` のSHA256。実ファイルはArtifactsに残し、Ledgerにはハッシュのみ保持。|
| `categories` | `blocked` / `needsReview` / `endpoint_error` などの件数。|
| `promptsArtifact` | `security_prompts.jsonl` のパス or ハッシュ。機微な内容の場合はハッシュのみにする。|
| `timestamp` | サマリ生成時刻 (`generatedAt`) 。|

## 3. 実装ポイント
1. **Sandbox Runner**
   - 既存の `security_summary.json` に `categories`, `promptsArtifact`, `endpointFailures`, `timeoutFailures` を記録済み。Ledger用にはSHA256を計算し、Temporalへ返す値に含める。
2. **Temporal Activities**
   - `runSecurityGate` の戻り値に `ledgerEntry` 的なフィールド（summary path + digest）を追加し、Workflowが完了したタイミングでAudit LedgerへPOSTするアクティビティを挟む。
3. **Auditライブラリ**
   - 既存の `publishToLedger` ヘルパーを再利用し、`securityLedgerEntry.json` を自動生成。オプションでHTTP送信。
4. **W&B & UI**
   - LedgerエントリのURL/ハッシュをWorkflow Progressに含め、Human Review UIやW&B Runから辿れるようにする。

## 4. 運用フロー
1. Security Gate実行 → サマリ/テンプレ/レポート生成。
2. Temporal `runSecurityGate` 完了後、`ledgerQueue`（仮）にエントリを投げる。
3. 別アクティビティ/cronが `publishToLedger` を呼び出し、結果のファイルパスをWorkflow Progressへ反映。
4. 監査時はTemporal History + Ledgerエントリ + Artifactsを突合。

## 5. 今後の課題
- Ledgerスキーマのバージョン管理（Security/Functional/Judgeで共通化）。
- 非公開情報（攻撃テンプレ）をどこまでLedgerに載せるか。デフォルトはハッシュのみ。
- 失敗時のリトライ戦略（Ledger APIがダウンしている場合の扱い）。
