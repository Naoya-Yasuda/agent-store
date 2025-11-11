# Review API / UI MVP (2025-11-10)

1. `GET /review/progress/:submissionId` : Temporal `queryProgress`直接フォワード。レスポンスには `stages`, `wandbRun`, `artifacts` を含める。
2. `POST /review/retry` : `{ submissionId, stage, reason }` で `signalRetryStage` を発火。
3. `POST /review/decision` : `{ submissionId, decision, notes }` でHuman Review承認/差戻しをサービス層に記録（現段階はTemporary signalで代用）。
4. UI側はNext.jsでステップバー・整形済みJSONビューワ・W&Bリンク・再実行/承認ボタンを提供し、`/review/progress` と `/review/artifacts` を叩いて証拠を表示する。
