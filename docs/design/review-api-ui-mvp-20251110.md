# Review API / UI MVP (2025-11-10)

1. `GET /review/progress/:submissionId` : Temporal `queryProgress`直接フォワード。レスポンスには `stages`, `wandbRun`, `artifacts` を含める。
2. `POST /review/retry` : `{ submissionId, stage, reason }` で `signalRetryStage` を発火。
3. `POST /review/decision` : `{ submissionId, decision, notes }` でHuman Review承認/差戻しをサービス層に記録（現段階はTemporary signalで代用）。
4. UI側はNext.js等でステップバー・JSONビューワ・W&Bリンクを表示する最小構成。Temporal API呼び出しは新設のExpressルート経由で行う。
