# Agent Store (PoC)

Agent Storeは、AIエージェントの登録・審査・公開を一貫して扱うリサーチ向けサンドボックスです。ExpressベースのSubmission/Catalog API、Python製Sandbox Runner、AISI Inspect連携ワーカーを同梱し、エージェントの安全性・機能性・ガバナンス指標を検証するためのプロトタイプになっています。

## エージェント登録と審査の流れ
1. **提出 (Submission API)**
   - 事業者はWeb UIでエンドポイントURL・署名付きAgentCard JSON・公開鍵・事業者IDをアップロード。
   - APIがJSON Schema（構造検証ルール）/署名検証/自己申告OpenAPIとの整合チェックを実施し、SubmissionレコードとEndpoint SnapshotをストアDBへ保存。成功時にTemporalワークフローへ`submission.created`イベントを送信。
2. **PreCheck (Temporalステージ)**
   - Submission IDを起点にA2Aチャレンジ（Nonce→署名応答）、Schema整合、差分検知を行い、問題があればHuman Reviewへ差戻し。
3. **Security Gate**
   - Sandbox RunnerがAdvBench（攻撃プロンプトデータセット）とAgentCard固有語彙を組み合わせた攻撃テンプレでSandbox実行。失敗ログは`sandbox-runner/artifacts/security_failures/`へ保存し、閾値超過時はHuman Review。
4. **Functional Accuracy**
   - AgentCard `useCases` からDSLシナリオを生成し、RAGTruth等のゴールドアンサーで回答突合。埋め込み距離（ベクトル類似度）も算出してLLM判定の保険にし、異常系成功時はHuman Review。
5. **Judge Panel**
   - Question Generator→Execution Agent→判定エージェントの三層構造でMCTS-Judge型評価を実行。矛盾・閾値境界はHuman Reviewへエスカレーション、確定Rejectは即時終了。
6. **Human Review / Publish**
   - レビュワーUIで観点別質問・証拠ログを参照し承認/差戻し。承認時にAgentCard `status`/`lastReviewedAt`更新とA2A Relay（Agent-to-Agent中継）解放を行い、ストアカタログに公開。

## Getting Started
- `python3.11 -m venv .venv && source .venv/bin/activate`
- `pip install -r requirements.txt`
- `pip install -e sandbox-runner` でローカルCLIを有効化。
- `pytest` を実行するとリポジトリ内のユニットテストのみが走ります（`pytest.ini`で外部チェックアウトを除外）。

## Key Components
- `api/`: Submission / Catalog APIルート・サービス。
- `sandbox-runner/`: AdvBenchテンプレやDSLシナリオを実行してpolicy/fairness成果物を生成するCLI。
- `prototype/inspect-worker/`: AISI Inspectワークフローと連携し、Judgeエージェントの結果をリプレイ。
- `docs/`: 設計メモと研究検討資料。

## Contributor Guide
完全なコントリビュータガイド、コーディング規約、PR要件は[`AGENTS.md`](AGENTS.md)を参照してください。
