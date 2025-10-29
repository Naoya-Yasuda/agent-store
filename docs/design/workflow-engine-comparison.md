# 審査ワークフロー基盤 比較メモ (2025-10-29)

## 候補
- Temporal (Self-hosted / Cloud SaaS)
- AWS Step Functions
- Apache Airflow (自前運用)

## 評価観点
| 観点 | Temporal | Step Functions | Airflow |
| --- | --- | --- | --- |
| 実行モデル | Event-driven, 長時間ワークフローを耐久スケジューラで管理 | サーバレスステートマシン | DAGベースのバッチ/定期処理 |
| コード記述 | TypeScript/Go/Java SDK。ロジックをコードで実装 | Amazon States Language(JSON/YAML) | Python DAG |
| リトライ/エラーハンドリング | アクティビティごとにポリシー定義可。ヒストリ保持で再実行容易 | ステートごとにリトライ指定可。ヒストリはCloudWatch | タスク単位のリトライ。状態管理はメタDBに依存 |
| SLA/Latency | ms単位でトリガ。長期実行(数日)もサポート | トリガ遅延~秒。90日まで保持 | 分単位が一般的。即時レスポンス用途は不向き |
| マルチリージョン | クラスタ構成必要。Temporal Cloudはマネージド | AWS内でリージョン制約。クロスリージョン不可 | 自前で構成。耐障害には工夫必要 |
| コスト | 自前クラスタ運用費 or SaaS利用料 | 呼び出し回数/状態遷移数で従量課金 | インフラ費(EC2/GKE等) + 管理コスト |
| ガバナンス/監査 | ワークフロー履歴をAPIで取得可能。ハッシュ化連携可 | CloudTrail/CloudWatchでイベント取得 | ログ中心。監査連携は自前 |
| 開発効率 | コードで完結。CI/CD統合容易 | JSON定義テンプレ化。複雑遷移は難解 | Python DAG慣れていれば可。動的分岐は複雑 |
| 外部サービス連携 | アクティビティから任意API呼び出し | Lambda/Service Integrations中心 | Operatorプラグインで拡張 |

## 推奨
- **Temporal** を第一候補とする。理由:
  - 多段審査・エスカレーションなど状態遷移が複雑でコードによる柔軟なロジックが必要。
  - ワークフロー履歴が詳細に記録され、`audit-ledger` と連携して監査用ハッシュ生成しやすい。
  - 自動リトライ、SLA監視、オンコール向け通知をアクティビティ単位で定義できる。
- Step FunctionsはAWSへの強いロックインになるが、AWS中心のインフラであれば一部ワークロード(軽量自動チェック)に併用可。
- Airflowはバッチ処理には適するが、リアルタイムな審査フロー制御にはオーバーヘッドが大きく優先度低。

## 次ステップ
1. Temporal Cloud と自前ホスティング(EKS/ECS)のコスト試算、権限モデル(RBAC)の確認。
2. サンプルワークフロー(Draft -> Sandbox -> Checks -> Review -> Publish)をTemporalでプロトタイピング。
3. Step Functionsでの実装難易度を簡易検証し、Temporal不採用時のバックアップ案を記録。
