# Human Review API & Ledger エンドポイント (2025-11-11)

審査ダッシュボードと自動化フローが共有するRESTエンドポイントを整理し、Ledger（監査台帳）情報をUI/CLI/W&Bから同じJSON構造で参照できるようにする。

## 1. API一覧
| メソッド | パス | 目的 | 主なレスポンス |
| --- | --- | --- | --- |
| GET | `/review/progress/:submissionId` | Temporalワークフロー進捗と各ステージ詳細を取得。 | `{ terminalState, stages, wandbRun, agentId, agentRevisionId, llmJudge }` |
| GET | `/review/ledger/:submissionId` | Ledgerエントリのみを抽出（UI無しでも監査可）。 | `{ submissionId, entries: [{ stage, entryPath, digest, workflowId, workflowRunId, generatedAt, sourceFile, downloadUrl }] }` |
| GET | `/review/events/:submissionId` | `metadata.json` 内の `wandbMcp.events` を取得し、Retry/エスカレーション履歴をUI/APIで再生。 | `{ submissionId, agentRevisionId, events: [{ id, stage, event, type, timestamp, data }] }` |
| GET | `/review/artifacts/:agentRevisionId?stage=judge&type=relay&agentId=foo` | ステージごとのJSON/JSONLアーティファクトをストリーミング取得。 | HTTPストリーム（`application/json` / `application/jsonl`）|
| POST | `/review/retry` | `signalRetryStage` を発火し、ステージ再実行を要求。 | `{ status: 'retry_requested' }` |
| POST | `/review/decision` | `signalHumanDecision` を送信し、人手審査決裁を記録。 | `{ status: 'decision_submitted' }` |
| POST | `/review/ledger/resend` | Ledger HTTP送信を手動で再実行し、ヘルスチェック結果を返す。 | `{ success: boolean, statusCode?: number }` |

> 参考: HTMLビュー (`/review/ui/:submissionId`) は上記APIをバックエンドで呼び、Ledgerリンク・LLM設定カード・Relayログプレビューをレンダリングする。

## 2. Ledgerレスポンス例
```json
{
  "submissionId": "subm-2025-001",
  "entries": [
    {
      "stage": "security",
      "entryPath": "/var/audit-ledger/security/security_ledger_entry.json",
      "digest": "0c9f2c9f...",
      "workflowId": "review-pipeline-subm-2025-001",
      "workflowRunId": "a1b2c3",
      "generatedAt": "2025-11-11T08:00:00Z",
      "sourceFile": "sandbox-runner/artifacts/subm-2025-001/security/security_ledger_entry.json",
      "downloadUrl": "/review/ledger/download?submissionId=subm-2025-001&stage=security"
    },
    {
      "stage": "functional",
      "entryPath": "/var/audit-ledger/functional/functional_ledger_entry.json",
      "digest": "3a29cafe...",
      "workflowId": "review-pipeline-subm-2025-001",
      "workflowRunId": "a1b2c3",
      "generatedAt": "2025-11-11T08:05:00Z",
      "sourceFile": "sandbox-runner/artifacts/subm-2025-001/functional/functional_ledger_entry.json",
      "downloadUrl": "/review/ledger/download?submissionId=subm-2025-001&stage=functional"
    },
    {
      "stage": "judge",
      "entryPath": "https://ledger.example.com/api/entries/abc123",
      "digest": "7d41cf20...",
      "workflowId": "review-pipeline-subm-2025-001",
      "workflowRunId": "a1b2c3",
      "generatedAt": "2025-11-11T08:10:00Z",
      "downloadUrl": "https://ledger.example.com/api/entries/abc123"
    }
  ]
}
```
- `entryPath` がHTTP/HTTPSならそのままブラウザ遷移可能。ローカルファイルパスの場合はCLIやSFTPで参照する。
- `sourceFile` はリポジトリ相対パス。`/review/ledger/download` はこのファイルをStreamingして返す。
- `digest` は `auditLedger.publishToLedger` が出力するSHA-256。UI/W&B/MCPツールはこれを基準に改ざん検知を行う。
- 2025-11-12 現在、レスポンスにはリモートLedgerのヘルスチェック結果（`remoteStatusCode`, `remoteLatencyMs`, `remoteReachable`, `remoteError`）も含まれる。UIカードやW&BイベントでLedger APIの可用性を即時に把握できる。

## 3. LedgerダウンロードAPI (`GET /review/ledger/download`)

| クエリ | 説明 |
| --- | --- |
| `submissionId` | 対象Submission。`/review/ledger/:id` と同じID。|
| `stage` | `security` / `functional` / `judge` / `human` などLedgerを持つステージ。|

- レスポンス成功時: `Content-Type: application/json; charset=utf-8`、`Content-Disposition: attachment; filename=<stage>-ledger.json`、`X-Ledger-Source: <repo-relative-path>` を付与し、ローカルLedgerファイルをストリーミング返却。`X-Ledger-Fallback: true` が付く場合は、`ledger.entryPath` が欠損していたため `sourceFile`（Sandbox Artifacts 配下の `*_ledger_entry.json`）から復元したことを示す。
- Ledgerファイルが存在しない/削除済みの場合でも、`entryPath` がHTTP/HTTPSであれば `/review/ledger/download` がリモートをフェッチしてローカルにキャッシュする。取得できなかった場合は `missingReason: 'remote_unreachable'`、`remoteStatusCode`、`remoteError` を返してUIに通知する。
- リモートフェッチに成功した場合は `X-Ledger-Remote: true`、`X-Ledger-Remote-Source`、`X-Ledger-Remote-Status`、`X-Ledger-Remote-Fetched-At` をヘッダーで返し、UI/CLIがキャッシュの経路を把握できる。ローカルFallbackを使った場合は従来どおり `X-Ledger-Fallback: true` を付与する。
- HTTP送信が失敗したLedgerは `POST /review/ledger/resend` を叩くことで即座に再送できる。UIではCard上の「HTTP再送」ボタンからこのエンドポイントを呼び出し、成功時は最新の `/review/ledger/:id` を再取得して状態を同期する。

## 3. 利用フロー
1. Reviewerは `/review/progress/:id` でAgent ID・LLM設定・ステージ状況を確認。
2. Ledger内容を監査・共有する場合は `/review/ledger/:id` を叩き、リンクをSlack/Jira等に貼り付け。
3. 追加エビデンスが必要なら `/review/artifacts/...` でJSONLを取得し、Judgeカードと照合。ローカルLedgerファイルは `/review/ledger/download?submissionId=...&stage=...` で取得できる。
4. 差戻し/承認は `/review/decision` 経由で送信。Temporalワークフローは `signalHumanDecision` を受信後、Humanステージを完了させ、`queryProgress` に決裁メモを残す。

## 4. イベントタイムライン (`GET /review/events/:submissionId`)
- Temporal Activities (`recordStageEvent` や `recordHumanDecisionMetadata`) が `sandbox-runner/artifacts/<revision>/metadata.json` の `wandbMcp.events` に書き込んだイベントをREST経由で公開。
- Human Review UIはこのエンドポイントを定期的にポーリングし、Retry理由/エスカレーション/人手決裁をタイムライン表で表示する。検索・ステージフィルタ付き。
- 失敗時はHTTP 404（Workflow未発見）または500（メタデータ読み込み失敗）で通知し、UIではW&BダッシュボードやCLIによる代替確認を促す。

## 5. 今後の拡張
- Ledgerレスポンスへ `sourceFile` や `metrics` を含め、複数回の審査にも対応。
- `/review/progress` にW&BダッシュボードURLやRelayリトライ統計を含む `metrics` セクションを追加し、UI以外のクライアントでも一貫した表示を実現。
- `POST /review/ledger/verify` （仮）でDigest検証を自動化し、CLIから即座に`audit-ledger`の整合性チェックを行えるようにする。
