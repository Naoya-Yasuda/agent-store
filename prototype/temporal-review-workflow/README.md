# Temporal Review Workflow PoC

このディレクトリは `docs/design/temporal-poc-plan.md` に基づき、審査ワークフローを Temporal で試作するためのPoC環境です。

## 構成
- `src/workflows/reviewPipeline.workflow.ts`: 審査フロー本体(ドラフト)。
- `src/activities/*.ts`: 各アクティビティのスタブ。
- `src/worker.ts`: Temporal Worker を起動するエントリーポイント。
- `src/client.ts`: ワークフローを起動/監視するための簡易クライアント。
- `package.json`: TypeScript SDKとツール類の依存管理。
- `temporal.config.ts`: NamespaceやTask Queue設定(ローカル向け)。

## ローカル実行メモ
1. temporalite などのローカルTemporalサーバを起動
2. `pnpm install` (pnpm推奨だがnpmでも可)
3. `pnpm start:dev` でワーカー起動
4. 別ターミナルで `pnpm ts-node src/client.ts` を実行してワークフローを起動
5. 完了後に `pnpm ts-node src/exportHistory.ts --workflow-id <ID> --ledger ledger-entry.json` で履歴JSONとSHA256、および監査用エントリを取得可能

実行時には `TODO` となっているAPIコール部分を適宜モックしてください。
