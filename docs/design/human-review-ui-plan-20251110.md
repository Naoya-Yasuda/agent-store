# Human Review UI / API 設計メモ (2025-11-10)

## 1. 目的
- Temporalワークフロー上の `HumanReview` ステージをUIから操作・監査できるようにし、ステージごとの証拠ログ（Security / Functional / Judge）を一画面で確認可能にする。

## 2. API エンドポイント案 (Express /api)
1. `GET /review/progress/:submissionId`
   - 返回: `stageStatuses`, `warnings`, `wandbRun`, `artifacts` (Security/Functional/JudgeのJSONパス) など。
   - 実装: Temporal `queryProgress()` を呼び出し、`metadata` からRun情報やレポートパスを付与。
2. `GET /review/artifacts/:submissionId/:stage`
   - 返回: 指定ステージのレポートJSON (stream) またはS3/GCS署名つきURL。
3. `POST /review/retry`
   - 入力: `{ submissionId, stage, reason }`。
   - 処理: Temporal `signalRetryStage(stage, reason)` を送信。
4. `POST /review/decision`
   - 入力: `{ submissionId, decision: "approved" | "rejected", notes }`。
   - 処理: Temporal `HumanReview` ステージを完了させ、`statusReason` に記録。

## 3. フロントエンド (最小要件)
- React/Vueなどで実装想定。初期段階では次の要素を表示:
  1. ステップバー: PreCheck → Security → Functional → Judge → Human → Publish、各ステージの `status`/`attempts` を色分け表示。
  2. 証拠タブ: Security (攻撃ログ), Functional (DSL結果), Judge (質問・判定)。JSONを整形表示 + ダウンロードボタン。
  3. 操作ボタン: 「再実行リクエスト」(stage選択 + reason入力)、「承認」「差戻し」。
  4. W&B Runリンク: `metadata.wandbRunUrl` を表示し、外部ダッシュボードへ遷移できるようにする。
  5. 監査メモ: 承認/差戻しの履歴、誰がいつ操作したか。

## 4. Temporal との連携
- `progressQuery` に `wandbRun` / `artifacts` / `lastUpdated` を追加し、UIがAPI経由で取得。
- `HumanReview` アクティビティは `notifyHumanReview` でUI向けのURLを生成し、`stageProgress['human']`の`message`にリンクを含める。

## 5. 実装ステップ
1. Expressで `/review/*` ルートを追加し、Temporal Clientを使って `queryProgress`/signals を呼べるようにする。
2. UIモック（例: Next.js / Vite）で進捗バーと証拠タブを実装。最初はJSON直表示で構わない。
3. 認証/認可（レビュワー専用Role）と監査ログ書き込みを追加。
4. Run ID / Artifact Path / Audit Ledgerリンクを表示し、レビュワーが必要な情報へ一跳びでアクセスできるようにする。
