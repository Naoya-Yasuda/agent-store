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
    │  (メタデータ検証)
    ▼
[Sandbox Runner] --(成果物: response_samples.jsonl, policy_score.json, tool logs)--> [ストレージ]
    │
    ▼
[審査エージェント (Google ADK)]
    ├─ Evidence Agent (資料取得 / RAG)
    ├─ Judge Agent(s) (LLM-as-a-Judge, Verdict)
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
| Evidence Agent | 観点別証拠収集 | arXiv/Bing 検索、モデルカード・ポリシー取得、RAG
| Judge Orchestrator | 評価観点→ジャッジタスク生成・集約 | Verdict API による検証・反証・集約ステップ
| Panel Judge Agents | LLM-as-a-Judge 実行 | Gemini, GPT-4o, Claude 等をモジュール化し多視点評価
| Trajectory Auditor | サンドボックスログのステップ検証 | ツール呼び出し監査、Hallucination 検知
| Reporting Agent | レポート出力 | JSON/PDF 出力、UI 用要約、レビュワー向け diff

## LLM-as-a-Judge 組込み
1. **複数ジャッジ**: Gemini 1.5 Pro、GPT-4o、Claude などを同一観点で稼働させ、Panel-of-Judges による合議制を採用。
2. **Judge-Time Compute**: Verdict \[1\] の検証・反証プロンプトをそのまま利用し、理由生成 → 反証 → 再評価 → 集約の 4 ステップを実装。
3. **バイアス対策**: Silent Judge \[2\] で指摘された表面的 cue への脆弱性を避けるため、ジャッジ prompt に真偽混在サンプルを混ぜて校正。Helpful-Agent vs Deceptive-Judge \[3\] に基づき、意図的にハルシネーションを誘発する adversarial judge をCIに導入。
4. **安全観点拡張**: Safe-Child-LLM \[4\] 等の脆弱利用者ベンチマークを periodic に投入し、評価観点の抜け漏れを検知。

## 評価観点・データセット統合
- **AISI/aisev**: `third_party/aisev/backend/dataset/output/*.csv` を観点テンプレートとして保有。各質問 json (`prompts/aisi/questions/*.json`) に `aisev` セクションを設け、対象CSV・GSNコード・キーワード等で対応行を元に質問/期待挙動を生成する。
- **外部ベンチマーク**:
  - **AIR-Bench 2024** (政策整合性・314リスクカテゴリ) \[5\]
  - **MLCommons AI Safety Benchmark v0.5** (企業向け安全・性能指標) \[6\]
  - **TrustLLM** (LLM信頼性評価ベンチマーク) \[7\]
  - **International AI Safety Report 2025** (国際的観点整理) \[8\]
- 観点カタログは「観点名 / GSN / 参考データセット / 推奨ジャッジ構成 / 必要エビデンス種別」の形式で整備し、審査エージェントが提出ごとに観点→質問→調査リストを動的生成する。

## 審査パイプライン詳細
1. **提出**: Web UI から Agent Card (メタデータ) とエージェントエンドポイント URL/API キーを登録。Submission API が受領し、初期検証の後に Temporal ワークフローへ投入。
2. **サンドボックス実行**: 既存 Sandbox Runner がテンプレートに基づきテスト対話を実行し、`response_samples.jsonl` などを生成。ネットワークは審査で許容するドメイン/API のみホワイトリスト化し、テスト用の限定 API キー／MCP エンドポイントを利用。ファイルアクセス・ネットワークログは監査用に収集する。
3. **審査エージェント呼出**: 審査エージェントが sandbox 成果物とエンドポイントを取得し、必要に応じて追加プロービング (攻撃的プロンプト/社内データアクセス検証) を実施。
4. **審査レポート格納**: Verdict 付き判定結果（観点別スコア、証拠リンク、推奨アクション）を DB/オブジェクトストレージに保存。
5. **承認判定**: 自動しきい値判定 + レビュワー確認。重大リスクがあれば差戻し。
6. **公開**: 承認済み Agent Card をストアに公開し、審査履歴をトレーサブルに保持。

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
