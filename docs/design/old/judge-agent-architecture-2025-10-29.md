# エージェントストア審査エージェント設計メモ (2025-10-29)

## 目的
- エージェントストアに登録されるエージェントの安全性・信頼性を自動審査する。
- Google Agent Development Kit (ADK) を用いて審査側もエージェント化し、ワークフロー全体をプログラム的に制御する。
- 最新の LLM-as-a-Judge 研究を取り入れ、複数視点・証拠駆動の評価を行う。
- AISI/aisev の評価観点・観点別データセットを参考にしつつ、必要に応じて外部ベンチマークも統合する。

## 全体アーキテクチャ
```
[登録Web UI]
    │  (Agent Card + エンドポイント情報を送信)
    ▼
[Submission API]
    │  (メタデータ検証 + 署名確認)
    ▼
[A2A Relay / Endpoint Snapshot]
    │  (チャレンジレスポンス、スナップショット保存)
    ▼
[Sandbox Runner] --(成果物: response_samples.jsonl, policy_score.json, tool logs)--> [ストレージ]
    │
    ▼
[審査エージェント (Google ADK)]
    ├─ Question Generator Agent (観点→質問テンプレ化)
    ├─ Evidence Agent (資料取得 / RAG)
    ├─ Judge Agent(s) (LLM-as-a-Judge, Verdict)
    ├─ Meta-Judge / Embedding Evaluator
    └─ Reporting Agent (レポート生成)
    │
    ▼
[審査レポート保存]
    │  (DB / オブジェクトストレージ)
    ▼
[承認判定ワークフロー]
    │  (自動 + 人手レビュー)
    ▼
[公開 / 差戻し]
```

## 審査エージェント構成 (Google ADK)
| エージェント | 役割 | 主要機能 |
| --- | --- | --- |
| Submission Validator | 提出メタデータ整合性チェック | JSON Schema バリデーション、PII フィルタ
| Sandbox Runner Agent | 既存サンドボックスジョブ実行 | CLI ラッパ / Temporal Activity（ネットワーク・資格情報制御付きサンドボックス）
| Question Generator Agent | 観点カタログから質問テンプレ生成・カード差異の検証 | AISI/AIR-Bench/MLCommons/TrustLLMを参照し、AgentCard語彙で自動リライト
| Evidence Agent | 観点別証拠収集 | arXiv/Bing 検索、モデルカード・ポリシー取得、RAG
| Judge Orchestrator | 評価観点→ジャッジタスク生成・集約 | Verdict/MCTS-Judgeスタイルの検証・反証・集約ステップ
| Panel Judge Agents | LLM-as-a-Judge 実行 | Gemini, GPT-4o, Claude 等をモジュール化し多視点評価
| Meta Judge / Embedding Evaluator | LLM評定のばらつき監視と埋め込み距離スコア算出 | MTEB互換エンコーダで回答/期待値をベクトル化し、閾値以下なら人手レビューへ
| Trajectory Auditor | サンドボックスログのステップ検証 | ツール呼び出し監査、Hallucination 検知
| Reporting Agent | レポート出力 | JSON/PDF 出力、UI 用要約、レビュワー向け diff

## LLM-as-a-Judge 組込み
1. **複数ジャッジ**: Gemini 1.5 Pro、GPT-4o、Claude などを同一観点で稼働させ、Panel-of-Judges による合議制を採用。
2. **Judge-Time Compute**: Verdict \[1\] や MCTS-Judge 系の検証・反証・シミュレーションを採用し、理由生成 → 反証 → 再評価 → 集約 → メタチェックの5ステップに拡張。
3. **バイアス対策**: Silent Judge \[2\] で指摘された表面的 cue への脆弱性を避けるため、ジャッジ prompt に真偽混在サンプルを混ぜて校正。Helpful-Agent vs Deceptive-Judge \[3\] に基づき、意図的にハルシネーションを誘発する adversarial judge をCIに導入。
4. **安全観点拡張**: Safe-Child-LLM \[4\] 等の脆弱利用者ベンチマークを periodic に投入し、評価観点の抜け漏れを検知。
5. **埋め込み保険**: MTEB互換エンコーダで回答とゴールドアンサーの距離を測り、LLM判定が揺れた場合の補助スコアとして利用する。

## 観点ベース質問生成
- 観点カタログ（AISI GSN + AIR-Bench + MLCommons + TrustLLM）を `perspective_id` 単位で管理し、Question Generator AgentがAgentCard `capabilities`/`useCases`/`complianceNotes` を解析して適用観点をフィルタ。
- AISI既存質問はテンプレートとしてのみ参照し、カードとのNLI比較で差異がある場合は自動で文面を修正してから審査に投入。
- AdvBenchなどの攻撃テンプレートにカード固有語彙を挿入し、PI耐性チェック専用の質問セットを生成。
- 正常系シナリオはカードのユースケースをDSL化した上でテストデータ（例: RAGTruth）に紐付け、異常系は「カードで禁止している行為」を明示的に列挙して誘導プロンプトを作成。
- 質問と観点はストアDBに保存し、審査ログUIで「観点→質問→根拠データセット」を横並び表示できるようにする。

## 評価観点・データセット統合
- **AISI/aisev**: `third_party/aisev/backend/dataset/output/*.csv` を観点テンプレートとして保有。各質問 json (`prompts/aisi/questions/*.json`) に `aisev` セクションを設け、対象CSV・GSNコード・キーワード等で対応行を元に質問/期待挙動を生成する。
- **外部ベンチマーク**:
  - **AIR-Bench 2024** (政策整合性・314リスクカテゴリ) \[5\]
  - **MLCommons AI Safety Benchmark v0.5** (企業向け安全・性能指標) \[6\]
  - **TrustLLM** (LLM信頼性評価ベンチマーク) \[7\]
  - **International AI Safety Report 2025** (国際的観点整理) \[8\]
- 観点カタログは「観点名 / GSN / 参考データセット / 推奨ジャッジ構成 / 必要エビデンス種別」の形式で整備し、審査エージェントが提出ごとに観点→質問→調査リストを動的生成する。

## 審査ステージ (Temporalワークフロー)
1. **Pre-check**: JSON Schema/署名検証、EndpointSnapshot取得、A2Aチャレンジレスポンスで実在性を確認。AgentCard差分に応じて再審査範囲を決定。
2. **Security / PI Gate**: Sandbox RunnerにAdvBench拡張テンプレートを投入し、Prompt Injectionやデータ抽出攻撃を試行。失敗ログは自動で`pi_failures/`に保存。
3. **Functional Accuracy**: カードユースケースDSL → シナリオ生成 → RAGTruth等ゴールドデータで回答を突合。Embedding Evaluatorが距離スコアを算出。
4. **Judge Panel**: Question Generator Agentが観点→質問→期待回答→証拠をまとめ、Panel Judge + Meta JudgeがVerdictを返却。矛盾した場合はHuman Reviewキューへ。
5. **Human Review / Publish**: レビュワーUIで観点別結果とAgentCardフィールド差異を表示し、承認/差戻しを決定。承認後にAgentCard `status`/`lastReviewedAt`を更新し、ユーザーがA2Aリレー経由でエージェントとやり取り可能になる。

## 審査パイプライン詳細
1. **提出**: Web UI から Agent Card とエンドポイント URL/APIキーを登録。Submission API が受領し、Temporalワークフローに投入。
2. **A2Aリレー登録**: EndpointSnapshot を取得し、`endpointRelayId` を払い出してストア内リレーに登録。ユーザーからの直接アクセスは不可にする。
3. **サンドボックス実行**: 既存 Sandbox Runner がテンプレートに基づきテスト対話を実行し、`response_samples.jsonl` などを生成。ネットワークは審査許可ドメインのみホワイトリスト化。
4. **審査エージェント呼出**: 観点ベース質問を生成し、正常/異常シナリオをSandboxログと突合。Panel Judge + Embedding Evaluatorがスコアを確定。
5. **審査レポート格納**: Verdict（観点別スコア、証拠リンク、埋め込み距離、推奨アクション）をDB/オブジェクトストレージに保存。
6. **承認判定**: 自動しきい値判定 + レビュワー確認。重大リスクがあれば差戻し。
7. **公開**: 承認済み Agent Card をストアに公開し、審査履歴とA2Aリレー設定をトレーサブルに保持。

## 今後のタスク
- Google ADK プロジェクト雛形 (`safety_review_agent`) の整備と審査ワークフロー実装。
- Verdict API + ADK 連携 PoC：複数ジャッジ／反証ステップの自動化。
- 観点カタログ v1 作成 (AISI GSN + AIR-Bench + MLCommons + TrustLLM)。
- レポートテンプレート定義（PDF/JSON/ダッシュボード）。
- 垂直連携（Submission サービス/API、Temporal ワークフロー、審査エージェント）の疎結合化。

## 参考論文・資料
1. **Verdict: Judge-Time Compute for Safety in Unknown Test Conditions**, Naik et al., 2025. <https://arxiv.org/abs/2502.18018>
2. **Silent Judge Biases Grade Prompts** (ACL Findings 2025). <https://aclanthology.org/2025.findings-acl.306/>
3. **When Helpful Agent Meets Deceptive Judge**, Shen et al., 2025. <https://arxiv.org/abs/2502.16617>
4. **Safe-Child-LLM Benchmark**, Mujkanovic et al., 2025. <https://arxiv.org/abs/2506.13510>
5. **AIR-Bench: Assessing Policy Alignment of LLMs**, Hu et al., 2024. <https://arxiv.org/abs/2407.17436>
6. **MLCommons AI Safety Benchmark v0.5**, 2024. <https://mlcommons.org/ai-safety/> 
7. **TrustLLM Benchmark**, Liu et al., 2023. <https://trustllm.github.io>
8. **International AI Safety Report 2025**, Organisation for Economic Co-operation and Development (OECD). <https://oecd.ai/en/safetyreport>
