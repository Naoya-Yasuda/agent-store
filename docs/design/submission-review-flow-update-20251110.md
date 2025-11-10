# Submission & Review Flow Update (2025-11-10)

## 1. 背景
- 2025-11-08付の再設計メモ (`docs/design/agent-store-review-redesign-20251108.md`) で提示された要件を、実装チームがそのままタスク化できる粒度に分解する。
- AgentCard仕様 (`docs/design/agent-card-spec.md`) と Temporal PoC計画 (`docs/design/temporal-poc-plan.md`) を維持しつつ、提出～審査の状態とストア保持ポリシーを明示する。
- 主対象: Submission API (`api/`), Sandbox Runner (`sandbox-runner/`), Temporal Review Workflow (`prototype/temporal-review-workflow/`), Inspect Worker (`prototype/inspect-worker/`).

## 2. 提出/登録フロー更新案
1. **Web UI**
   - 入力フィールドを4点に固定: エンドポイントURL, AgentCard JSON, 公開鍵, 事業者ID。
   - アップロード直後にフロントでJSON Schema (構造検証ルール) のプレチェックを実施し、エラーを即時表示。
2. **Submission API**
   - `POST /submissions` を新設して `agentId`, `cardDocument`, `endpointManifest`, `signatureBundle` を受領。
   - 実装: `api/routes/submissions.ts` で `validateSubmissionPayload` → `createSubmission` の順に処理。
   - 署名バンドルは `algorithm` (`rsa-sha256` or `ecdsa-sha256`), `publicKeyPem`, `signature`, `payloadDigest` を含み、`cardDocument` の安定化JSON（キーソート）に対するSHA256照合後にVerify APIを実行。
   - 検証チェーン:
     1. `schemas/agent-card.schema.json` によるバリデーション。
     2. `signatureBundle` と事業者公開鍵を使った署名検証。
     3. `endpointManifest` (OpenAPI/manifest) と AgentCard `capabilities`/`useCases` の突合。
   4. Snapshot生成: `AgentEndpointSnapshot` レコードを `endpointRelayId` と紐付けて保存。
   - 成功時にTemporalへ `submission.created` イベントを発行し、レスポンスでは公開用メタ情報のみ返却。
3. **ストアDB保持**
   - AgentCardの完全コピーを `agent_cards` テーブルに保存し、公開APIでは `displayName` 等の最小フィールドのみ返す。
   - 審査完了まで実エンドポイントURLはA2A Relay (Agent-to-Agent中継サーバ) からしか参照できないようにACLを設定。
4. **再提出ポリシー**
   - `executionProfile` か `providerRegistryIds` に変更がある場合はPre-checkからやり直し。
   - それ以外はSnapshotハッシュ差分に基づきステージスキップ可否を判定。

## 3. Temporalワークフロー再配置
Temporal (分散ワークフローエンジン) 上で以下のState Machineを実装する。

| State | 入力 | アクティビティ | 成功時遷移 | 失敗時処理 |
| --- | --- | --- | --- | --- |
| `PreCheck` | Submission ID | JSON Schema検証, 署名検証, A2Aチャレンジ (Nonce→署名→RTT測定) | `SecurityGate` | Retries + 手動差戻し |
| `SecurityGate` | Snapshot, Attack Templates | AdvBenchプロービング + ログ保存 (`sandbox-runner/attacks/`) | `FunctionalAccuracy` | `security_failures/` へアーティファクト保存しHuman Reviewへ |
| `FunctionalAccuracy` | DSLシナリオ, ゴールドアンサー | Sandbox Runner DSL実行, RAGTruth突合, Embedding距離計算 | `JudgePanel` | `functional_failures/` に記録 + Human Review |
| `JudgePanel` | 観点リスト, 質問テンプレ, Sandboxログ | Question Generator → Execution Agent → Panel Judge (MCTS-Judge) | `HumanReview` or `Publish` | `judge_conflicts/` に証跡保存しHuman Review |
| `HumanReview` | 観点別レポート | Reviewer UIへのリンク生成, 承認/差戻しログ更新 | `Publish` or `Rejected` | - |
| `Publish` | AgentCard, Relay設定 | AgentCard `status` 更新, Catalog反映, A2A Relay解放 | 終了 | - |

### Signals / Queries
- `signalRetryStage(stage, reason)` : 監査orレビュワーがステージ再実行を要求。
- `queryProgress()` : UIがPre-check→Humanまでの進捗バーを取得。

### アーティファクト配置
- `sandbox-runner/artifacts/<submission>/<stage>/` にステージ成果物(JSON/ログ) を保存し、Temporal History IDと紐付ける。
- `prototype/inspect-worker/out/<agent>/<revision>/summary.json` をHuman Review画面に添付。

## 4. データ契約・スキーマ差分
| 項目 | 変更内容 | 影響コード |
| --- | --- | --- |
| AgentCard `executionProfile` | enum `self_hosted` / `store_hosted_candidate` を必須に昇格 | `schemas/agent-card.schema.json`, `prototype/temporal-review-workflow/src/types/agent.ts` |
| AgentCard `providerRegistryIds` | FCC等の登録IDを格納。`^[A-Z0-9\-]{4,32}$` バリデーションを強制 | Submission API DTO, DBマイグレーション |
| Submission API Payload | `signatureBundle` (署名チェーンメタ) と `endpointManifest` (自己申告OpenAPI) を必須追加 | `api/routes/submissions.ts`, `api/services/submissionService.ts` |
| Temporal Signals | `signalRetryStage`/`queryProgress` を Workflow Interface に追加 | `prototype/temporal-review-workflow/workflows/reviewPipeline.ts` |

## 5. ログ・監査指針
- A2Aチャレンジ結果を `AgentEndpointAttestations` に保存し、`governance-hub` から閲覧可能にする。
- AdvBench失敗ケースは `pi_failures/` ディレクトリにJSONで保管し、`scripts/run_inspect_flow.sh` のレポートへ自動添付。
- Temporal履歴IDを`audit-ledger`にハッシュ登録し、`statusReason` に各ステージ要約を同期。

## 6. 今後のフォローアップ
1. Submission API実装チケット: 署名検証ライブラリ選定、AgentCard Schema同期、自動テスト。
2. Temporal Workflow拡張チケット: 新State/Signal実装、Retry/Timeoutポリシー設定、ledger連携。
3. UI刷新チケット: 登録/進捗/審査結果ビューのワイヤーフレームとAPI結線。
4. Sandbox Runnerタスク: AdvBenchテンプレ拡張、DSLシナリオ実行、Embeddingスコア算出ユーティリティ。
5. Judge Orchestratorタスク: Question Generator/Panel Judge/Meta JudgeのMCTSチェーン制御、Human Reviewルーティング条件の実装。
