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

## Getting Started
- `python3.13 -m venv .venv && source .venv/bin/activate`
- `pip install -r requirements.txt`
- `pip install -e sandbox-runner` でローカルCLIを有効化（Google ADKテンプレートを含むSandbox Runnerコマンドが利用可能になります）。
- `pytest` を実行するとリポジトリ内のユニットテストのみが走ります（`pytest.ini`で外部チェックアウトを除外）。
- Security Gateをローカルで試す場合は `sandbox-runner` で
  ```bash
  python3.13 -m sandbox_runner.cli \
    --agent-id demo --revision rev1 --template google-adk \\
    --security-dataset third_party/aisev/backend/dataset/output/06_aisi_security_v0.1.csv \\
    --security-attempts 5 --output-dir sandbox-runner/artifacts
  ```
  を実行してください。`--security-endpoint` を指定すると実エージェントに対して攻撃プロンプトを送出できます（未指定の場合は`not_executed`として記録）。

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
| Judge Panel (MCTS-Judge) | ⏳ 未実装 | Question Generator/Execution/判定エージェントはまだ疑似戻り値。 |
| Human Review UI連携 | ⏳ 未実装 | Temporal Signal/Queryに連携するUIはPlaceholder状態。 |

> ※実装や設計の更新を行った際は、必ず本READMEのステータステーブルと該当セクションを更新してください。

## 今後の優先タスク
1. **Sandbox RunnerのSecurity Gate実装**: AdvBenchテンプレを`third_party/aisev`から取り込み、AgentCard語彙でリライトする前処理と実行ログ保存を行う。`runSecurityGate`アクティビティのダミー出力を置換し、`pytest`で攻撃成功/失敗ケースを追加する。
2. **Functional Accuracyステージ実装**: DSLジェネレータとRAGTruth突合ロジック、Embedding距離算出を実装し、`runFunctionalAccuracy`を実データ指向に更新する。
3. **Judge Panel本実装**: Question Generator / Execution Agent / 判定エージェントを`prototype/inspect-worker`に実装し、MCTS-Judge手順でスコアとログを返す。
4. **Human Review UI最小版**: `queryProgress`/`signalRetryStage`を叩けるレビュワーダッシュボードと、各ステージアーティファクトへのリンク表示を作成する。
5. **Observability & Ledger整備**: Temporal→Sandbox Runner→Inspect間でOpenTelemetryトレースIDを伝播し、`audit-ledger`への履歴書き込みを自動化する。

## Contributor Guide
完全なコントリビュータガイド、コーディング規約、PR要件は[`AGENTS.md`](AGENTS.md)を参照してください。
