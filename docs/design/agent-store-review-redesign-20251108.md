# Agent Store 審査再設計メモ (2025-11-08)

## 0. 既存設計との対応
- `docs/design/agent-card-spec.md` のデータモデル・API契約を継承し、今回の要件で求められた「カードをストア側で保持し、審査完了まで外部公開を制限する」運用ルールを追記。
- `docs/design/judge-agent-architecture.md` の審査エージェント構成を前提に、LLM-as-a-Judgeの多層合議制とA2Aプロトコル連携を強化。
- `docs/design/governance-hub-spec.md` と Temporal連携案（`docs/design/temporal-poc-plan.md`）を踏まえて、審査ステージをWorkflow上のStateとして再配置。
- `docs/README.md` のリサーチドリブン設計原則（AIR-Bench, MLCommons等）を参照し、観点→質問→評価をデータセット起点で自動生成する方針を維持。

## 1. 提出と登録フロー
1. 事業者はWeb UIから以下を登録:
   - エージェントエンドポイントURL（A2A準拠）
   - エージェントカードJSON（署名付き）
   - 公開鍵/運用組織メタ情報
2. Submission APIがカードスキーマ検証、署名検証、カード記述とエンドポイント自己申告（OpenAPI/manifest）の整合をチェック。
3. ストアはカードを内部DBに複製し、審査完了まではユーザー公開用にはメタ情報のみを提示。実エンドポイントは審査ジョブのみに使用。 

## 2. 審査ワークフロー（Temporalステート）
1. **Pre-check**: JSON Schema + 署名チェーン + 実在性チャレンジ（ワンタイムNonceをA2Aメッセージで送付し、レスポンス署名とRTTを記録）。
2. **Security / PI Gate**: AdvBench系攻撃プロンプト + カード固有語彙を組み合わせたプロービングをSandbox Runner経由で実行。失敗時ログを自動保存。
3. **Functional Accuracy**: カードの`capabilities`ごとにシナリオDSLを生成し、RAGTruth等のゴールドアンサーで回答突合。埋め込み距離スコアも算出してLLM判定の保険にする。
4. **LLM Judge Panel**: Judge Orchestratorが質問生成エージェント→審査実行エージェント→判定エージェント（三層）を呼び出し、MCTS-Judge型の思考チェーンでスコアを決定。閾値近辺/矛盾時はHuman Reviewステージへ。
5. **Human Review / Publish**: レビュワーUIで「観点→質問→証拠→判定」を閲覧し、承認/差戻し。公開時にAgentCardの`status`/`lastReviewedAt`を更新し、ユーザーとエージェントが直接対話可能になる。

## 3. 評価観点と質問生成
- 観点カタログは AISI GSN + AIR-Bench + MLCommons + TrustLLM をマッピングし、各観点に「参考データセット・テンプレ質問・必要ログ」を紐付け。
- 提出ごとにカード`description`/`capabilities`/`domain_tags`を解析して観点をフィルタし、質問テンプレをエージェント固有語彙にリライト。
- AISI既存質問は“参考”扱いで固定化せず、毎回カードとの差異をLLMでチェックしてから投げる。
- PI耐性→正常系→異常系の順で試行。異常系は「カードに記述されていない行為の誘導」が成功したら即Fail。

## 4. "本物"エージェント判定
- A2Aチャネルでのチャレンジレスポンスを標準化し、レスポンス署名・実行環境フィンガープリント・バージョンハッシュを収集。
- サンドボックス経由以外のアクセスは禁止し、再審査時はハッシュ差分がある場合のみ再テストをトリガー。
- ストア内に「A2A Relay」を配置し、ユーザー流量は審査合格後のみRelay→エージェントに接続。

## 5. UI要件
- 登録画面: エンドポイントURL / AgentCard JSONアップロード / 公開鍵 / 事業者ID のみ。
- ステータス画面: Pre-check → Security → Functional → Judge → Human の進捗バーと各ステージの結果サマリ。
- 審査結果画面: AgentCard表示＋テストログ（質問・判定・根拠データセット）を並列表示。差戻し理由はCardフィールドとリンクさせる。

## 6. 将来拡張
- ストアホスティング対応を見据えて、AgentCardに `executionProfile` (self-hosted / store-hosted) メタデータを追加。
- MVNO等スマホ事業者向けに、FCC等の登録ID欄をオプションで持たせ、後続の自動チェックに備える。
- パイプライン全体をエージェント化（質問生成/実行/判定）する設計をPoC化し、Judgeエージェントの性能評価を継続トラッキング。
- 異常検知エージェントを本番トラフィックに常駐させ、審査時と同じ観点を定期的に再実行してドリフトを検知。

