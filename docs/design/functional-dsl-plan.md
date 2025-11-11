# Functional DSL / RAGTruth 運用メモ (ドラフト)

## 1. 目的
- AgentCardに記載された `useCases` / `capabilities` をもとに、Sandbox Runnerが機械可読なシナリオDSLを生成する。
- 生成したシナリオをRAGTruth（正解データセット）と照合し、Functional Accuracyステージで自動判定する。
- 正解データは運用チームが事前に管理し、審査時は常に同じ期待値で判定できるようにする。

## 2. データ構成
- `sandbox-runner/resources/ragtruth/*.jsonl`
  - `useCase`: AgentCardの`useCases`と一致させるキー
  - `question`: シナリオ説明や例示
  - `answer`: 期待される回答（JSONL1行につき1レコード）
  - `tags`/`locale` など補助情報を追加しても良い
- Functional Accuracy実行時には、AgentCardで参照できなかった場合に最も近いレコードやデフォルト回答を使用する。必要であればヒューマンレビューで期待値を採択後、RAGTruthに追加する。

## 3. 運用フロー
1. **正解データ作成**: ドメイン担当が`ragtruth/*.jsonl`を編集し、PRレビューを経てmainへマージ。
2. **AgentCard提出**: 提出時点で`useCases`がRAGTruthに存在するか確認。足りない場合は運用にエスカレーションして正解データを追加する。
3. **Functional Accuracy実行**: Sandbox Runnerがシナリオ→RAGTruth照合→レポート出力まで自動処理。
4. **Human Review**: Temporal/ダッシュボード経由で`functional_report.jsonl`や`functional_scenarios.jsonl`を確認し、要再実行や手動判定を行う。

## 4. 自動化/将来拡張
- AgentCardに新しい`useCase`が追加された際、自動的にRAGレコードを生成（LLMで仮回答）し、レビュワーが承認したら`ragtruth`へ登録するワークフローを検討中。
- Embedding距離評価を導入し、単語一致以外の意味類似度でも判定する（Functional AccuracyのメトリクスとしてTemporal/UIへ返す）。
