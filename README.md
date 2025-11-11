# Agent Store (PoC)

Agent Storeは、AIエージェントを「提出→審査→公開」するまで一気通貫で扱うための研究用サンドボックスです。Express（Node.js向けWebアプリフレームワーク）製API、Python製Sandbox Runner（自動テスト実行ツール）、Google Agent Development Kit（Google ADK: Google提供のエージェント実装テンプレート）ベースの攻撃/審査エージェント、AISI Inspect（外部評価ツール）連携ワーカーを組み合わせ、エージェントの安全性と機能性を検証します。

## エージェント登録と審査のやさしい流れ
以下では専門用語に簡単な説明を添えています。

1. **提出 (Submission API)**
   - Web UIで入力するもの: エンドポイントURL、署名付きAgentCard JSON（エージェントの自己紹介データ）、公開鍵（暗号署名の検証に使う鍵）、事業者ID。
   - Submission APIは次のチェックを実行します。
     - JSON Schema（データ構造ルール）でAgentCardの形式を確認。
     - デジタル署名検証で改ざんが無いか確認。
     - OpenAPI/manifest（エンドポイント仕様書）とAgentCardの記載が矛盾していないか確認。
   - 問題が無ければSubmissionレコードとEndpoint Snapshot（提出時点のエンドポイント情報）をDBに保存し、Temporal（分散ワークフローエンジン。段階的な処理を自動で進行させる基盤）へ`submission.created`イベントを送ります。

2. **PreCheck (Temporalステージ1)**
   - TemporalワークフローがSubmission IDを受け取り、A2Aチャレンジ（Agent-to-Agent通信の実在確認。Nonce=使い捨て乱数を送り、署名付き応答を得る手順）とスキーマ整合を再チェック。問題があればHuman Review（人手確認）に差し戻します。

3. **Security Gate (ステージ2)**
   - Sandbox Runner（Python CLI）がGoogle ADK製の攻撃エージェント（Attack Agent）を起動し、AdvBench（攻撃プロンプト集。`scripts/setup_aisev.sh`でクローンする`third_party/aisev`から取得）+AgentCard固有語彙でリライトしたプロンプトを生成。
   - Attack AgentはA2A Relay（Agent-to-Agent中継。審査中のみ実エンドポイントを開くゲートウェイ）経由で提出エージェントと実際に対話し、レスポンスログを`security/security_report.jsonl`として保存。拒否応答でない場合はHuman Reviewにエスカレーションします。

4. **Functional Accuracy (ステージ3)**
   - AgentCardの`useCases`からDSL（Domain Specific Language: ユースケースを機械可読にした言語）シナリオを作り、RAGTruth（正解データセット）で回答を照合。Embedding距離（数値化した回答の近さ）も計算し、想定外の振る舞いがあればHuman Reviewへ。

5. **Judge Panel (ステージ4)**
   - Question Generator→Execution Agent→判定エージェントで構成されたMCTS-Judge（Monte Carlo Tree Searchを応用した合議）を実行。Execution AgentはGoogle ADKテンプレートをベースにA2A Relay経由で提出エージェントと会話し、結果がグレーゾーンならHuman Review、明確な拒否なら即リジェクト。

6. **Human Review / Publish (最終ステージ)**
   - レビュワーUIで観点別の質問・証拠ログを確認し承認/差戻しを決定。承認するとAgentCardの`status`/`lastReviewedAt`を更新し、A2A Relay（審査完了まで実エンドポイントを隔離する中継サーバ）を解放してストアに公開されます。

## フロー図 (Mermaid)
```mermaid
flowchart TD
  subgraph 提出フェーズ
    A["Web UI<br/>(エンドポイントURL・AgentCard JSON・公開鍵・事業者ID)"] --> B["Submission API<br/>JSON Schema検証 / 署名検証 / Manifest整合"]
    B --> C[("Store DB<br/>AgentCards / Submissions / EndpointSnapshots")]
    B --> D["A2A Relay<br/>(審査専用接続)"]
  end

  B -->|submission.created| E["Temporal: PreCheck<br/>A2Aチャレンジ / 差分判定"]
  E -->|OK| F{"Security Gate<br/>Google ADK攻撃エージェント + AdvBench"}
  E -- 差戻し --> H0["人手レビュー"]

  F -->|OK| G{"Functional Accuracy<br/>DSLシナリオ + RAGTruth突合 + 埋め込み距離"}
  F -- 異常検知 --> H1["人手レビュー"]

  G -->|OK| I{"Judge Panel<br/>質問生成→実行→MCTS-Judge"}
  G -- 異常検知 --> H2["人手レビュー"]

  I -->|承認| J["Publish<br/>AgentCard更新 + Relay解放"]
  I -- 手動判定 --> H3["人手レビュー"]
  I -- 否認 --> K["Rejected"]

  H0 -->|承認| F
  H1 -->|承認| G
  H2 -->|承認| I
  H3 -->|承認| J
  H0 -->|差戻し| K
  H1 -->|差戻し| K
  H2 -->|差戻し| K
  H3 -->|差戻し| K

  subgraph 観測レイヤー
    W["W&B MCP<br/>Run / Artifact"]
    T["OpenTelemetryトレース"]
  end
  W -.-> F
  W -.-> G
  W -.-> I
  T -.-> E
  T -.-> F
  T -.-> G
  T -.-> I
```

## Getting Started
- `python3.13 -m venv .venv && source .venv/bin/activate`
- `pip install -r requirements.txt`
- `pip install -e sandbox-runner` でローカルCLIを有効化（Google ADKテンプレートを含むSandbox Runnerコマンドが利用可能になります）。
- `pytest` を実行するとリポジトリ内のユニットテストのみが走ります（`pytest.ini`で外部チェックアウトを除外）。
- W&B MCPを使ってステージログ/アーティファクトを収集する場合は `. .venv/bin/activate && export WANDB_DISABLED=false` を設定してから各コマンドを実行してください（デフォルトでは有効化されますが、明示的にフラグを確認できます）。Submission APIから`telemetry.wandb`フィールドでRun ID/Project/Entity/BaseURLを渡すと、同じRunをTemporalやSandbox Runnerが再利用できます。
- Security Gateをローカルで試す場合は `sandbox-runner` で
  ```bash
  python3.13 -m sandbox_runner.cli \
    --agent-id demo --revision rev1 --template google-adk \\
    --security-dataset third_party/aisev/backend/dataset/output/06_aisi_security_v0.1.csv \\
    --security-attempts 5 --output-dir sandbox-runner/artifacts
  ```
  を実行してください。`--security-endpoint` を指定すると実エージェントに対して攻撃プロンプトを送出できます（未指定の場合は`not_executed`として記録）。
- Functional Accuracy（機能正確性）を試す場合は、AgentCard JSONとRAGTruthディレクトリを指定します。サンプルは`sandbox-runner/resources/ragtruth/sample.jsonl`にあります。
  ```bash
  python3.13 -m sandbox_runner.cli \
    --agent-id demo --revision rev1 --template google-adk \\
    --agent-card path/to/agent_card.json \\
    --ragtruth-dir sandbox-runner/resources/ragtruth \\
    --output-dir sandbox-runner/artifacts
  ```
- Judge Panel（Inspect Worker側のGoogle ADKチェーン）を試す場合は `prototype/inspect-worker` で
  ```bash
  cd prototype/inspect-worker
  python scripts/run_eval.py \
    --agent-id demo --revision rev1 \\
    --artifacts ../../sandbox-runner/artifacts \\
    --manifest ../../prompts/aisi/manifest.tier3.json \\
    --enable-judge-panel --agent-card path/to/agent_card.json \\
    --judge-dry-run
  ```
  を実行すると `out/<agent>/<revision>/judge/judge_report.jsonl` と `judge_summary.json` が生成されます。`--relay-endpoint` を指定すればA2A Relay経由で実エージェントに質問できます。
- Human Review UIは `GET /review/ui/:submissionId` で確認できます。ステージ状況、W&Bダッシュボードリンク、再実行フォーム、承認/差戻しボタンが表示されます（バックエンド: `api/routes/reviews.ts`）。
- Next.js版のHuman Reviewダッシュボード（`review-ui/`）も用意しています。`cd review-ui && npm install && npm run dev`で起動し、`http://localhost:3000`からAPI経由で進捗・W&Bリンク・証拠ダウンロードを確認できます。

## W&B MCP 連携
- Sandbox Runnerは各実行でW&B Runを生成し（`wandb_run_id`は`sandbox-runner/src/sandbox_runner/cli.py`の`init_wandb_run`で払い出し）、`metadata.json`の`wandbMcp`にRun IDとステージサマリを記録します。
- ダッシュボードURLは `https://wandb.ai/<entity>/<project>/runs/<runId>`（CLIの`--wandb-entity`/`--wandb-project`/`--wandb-base-url`で指定）です。デフォルトは`project=agent-store-sandbox`,`entity=local`なので、実運用では `--wandb-base-url https://wandb.ai --wandb-entity <org> --wandb-project <proj>` のように明示してください。
- Security Gate実行時には`security/security_report.jsonl`をW&B Artifactとしてアップロードし、ステージ別サマリ（blocked件数、needsReview件数など）がRunのチャートに反映されます。Functional Accuracyを有効にした場合は`functional/functional_report.jsonl`も同じRunに保存され、Embedding距離の統計を確認できます（Judge/ Human Reviewについても今後同様に拡張予定）。`--wandb-run-id`を渡すと既存Runへ継続記録できます。
- 運用方針: PoCや素早い可視化が目的なら公式SaaS( `https://wandb.ai` )が便利ですが、審査ログを外部に出せない場合はローカル/Private CloudのW&B MCPサーバを用意し`--wandb-base-url http://localhost:XXXX`のように切り替えてください。

## Key Components
- `api/`: Submission / Catalog APIルート・サービス。
- `sandbox-runner/`: Google ADKベースの攻撃/審査エージェントを起動し、AdvBenchテンプレやDSLシナリオを実行してpolicy/fairness成果物を生成するCLI。
- `prototype/inspect-worker/`: AISI Inspectワークフローと連携し、Judgeエージェントの結果をリプレイ。
- `docs/`: 設計メモと研究検討資料。

## 実装ステータス (2025-11-10時点)
| 機能領域 | 状態 | メモ |
| --- | --- | --- |
| Submission API（提出〜スナップショット保存） | ✅ 実装済み | JSON Schema/署名/Manifest検証とDB保存を完了。Temporal連携イベントも送出。 |
| Temporalワークフロー（PreCheck→Publish） | ✅ 実装済み | `signalRetryStage`/`queryProgress`対応。各ステージはモック活動で接続済み。 |
| Sandbox RunnerのAdvBench統合 | 🚧 部分実装 | AISI/AdvBench由来CSVから攻撃プロンプトを抽出し`security_report.jsonl`を生成済み。実エンドポイント実行は今後の拡張。 |
| Functional DSL + RAGTruth突合 | ⏳ 未実装 | DSL生成やEmbedding距離算出は設計済みだがコード未着手。 |
| Judge Panel (MCTS-Judge) | 🚧 部分実装 | Inspect WorkerのGoogle ADK型Judgeチェーンを実装（Judgeレポート/サマリ出力）。Temporal連携・UIは今後。 |
| Human Review UI連携 | ⏳ 未実装 | Temporal Signal/Queryに連携するUIはPlaceholder状態。 |
| W&B MCPトレース連携 | ⏳ 未実装 | Sandbox Runner/Temporalから共通のW&B Run IDを発行し、Artifacts/LogsをMCP経由で蓄積する仕組みを今後実装。 |

> ※実装や設計の更新を行った際は、必ず本READMEのステータステーブルと該当セクションを更新してください。

## 今後の優先タスク
1. **Temporalアクティビティの本格実装 (完了/2025-11-11)**: Security/Functional/Judge各ステージで`sandbox_runner.cli`とInspect Worker CLIを実行し、Relay情報とW&B Run IDを引き回して実際の成果物を生成する。`runSecurityGate`/`runFunctionalAccuracy`/`runJudgePanel`はいずれもステージサマリとアーティファクトヒントをTemporal `queryProgress`に返すようになった。
2. **Human Review UI強化 (完了/2025-11-11)**: Next.js製ダッシュボードが `/review/progress` と `/review/artifacts` を利用し、証拠JSON整形表示・再実行リクエスト・承認/差戻しフォーム・操作履歴テーブルを提供する。
3. **Inspect Worker Relay強化 (完了/2025-11-11)**: Judge PanelがRelay HTTP呼び出しの詳細ログ（レスポンス/エラー/禁止語フラグ）を`relay_logs.jsonl`として保存し、W&Bアーティファクトにも添付。Human Review UIからも同じログをダウンロードできる。

## Contributor Guide
完全なコントリビュータガイド、コーディング規約、PR要件は[`AGENTS.md`](AGENTS.md)を参照してください。
