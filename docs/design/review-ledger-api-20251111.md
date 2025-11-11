# Human Review API & Ledger エンドポイント (2025-11-11)

審査ダッシュボードと自動化フローが共有するRESTエンドポイントを整理し、Ledger（監査台帳）情報をUI/CLI/W&Bから同じJSON構造で参照できるようにする。

## 1. API一覧
| メソッド | パス | 目的 | 主なレスポンス |
| --- | --- | --- | --- |
| GET | `/review/progress/:submissionId` | Temporalワークフロー進捗と各ステージ詳細を取得。 | `{ terminalState, stages, wandbRun, agentId, agentRevisionId, llmJudge }` |
| GET | `/review/ledger/:submissionId` | Ledgerエントリのみを抽出（UI無しでも監査可）。 | `{ submissionId, entries: [{ stage, entryPath, digest, workflowId, workflowRunId, generatedAt, downloadUrl }] }` |
| GET | `/review/artifacts/:agentRevisionId?stage=judge&type=relay&agentId=foo` | ステージごとのJSON/JSONLアーティファクトをストリーミング取得。 | HTTPストリーム（`application/json` / `application/jsonl`）|
| POST | `/review/retry` | `signalRetryStage` を発火し、ステージ再実行を要求。 | `{ status: 'retry_requested' }` |
| POST | `/review/decision` | `signalHumanDecision` を送信し、人手審査決裁を記録。 | `{ status: 'decision_submitted' }` |

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
      "downloadUrl": "/review/ledger/download?submissionId=subm-2025-001&stage=security"
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
- `digest` は `auditLedger.publishToLedger` が出力するSHA-256。UI/W&B/MCPツールはこれを基準に改ざん検知を行う。

## 3. 利用フロー
1. Reviewerは `/review/progress/:id` でAgent ID・LLM設定・ステージ状況を確認。
2. Ledger内容を監査・共有する場合は `/review/ledger/:id` を叩き、リンクをSlack/Jira等に貼り付け。
3. 追加エビデンスが必要なら `/review/artifacts/...` でJSONLを取得し、Judgeカードと照合。ローカルLedgerファイルは `/review/ledger/download?submissionId=...&stage=...` で取得できる。
4. 差戻し/承認は `/review/decision` 経由で送信。Temporalワークフローは `signalHumanDecision` を受信後、Humanステージを完了させ、`queryProgress` に決裁メモを残す。

## 4. 今後の拡張
- Ledgerレスポンスへ `sourceFile` や `metrics` を含め、複数回の審査にも対応。
- `/review/progress` にW&BダッシュボードURLやRelayリトライ統計を含む `metrics` セクションを追加し、UI以外のクライアントでも一貫した表示を実現。
- `POST /review/ledger/verify` （仮）でDigest検証を自動化し、CLIから即座に`audit-ledger`の整合性チェックを行えるようにする。
