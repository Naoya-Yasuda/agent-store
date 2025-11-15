# Mock Flight Agent

GPT-4o-miniを使用したAI搭載フライト予約アシスタントのモック実装です。

## 機能

- フライト検索
- 価格比較
- 空席状況の確認
- 自然言語での対話

## エンドポイント

- **Agent Card**: `http://localhost:4000/agent-card.json`
- **Chat Endpoint**: `http://localhost:4000/agent/chat`
- **Health Check**: `http://localhost:4000/health`

## RAGTruth（期待値データ）

`ragtruth.jsonl`ファイルは、Functional Accuracyテストで使用される期待値データを定義します。

### フォーマット

各行は以下の形式のJSONオブジェクトです：

```json
{
  "useCase": "Agent Cardで定義されたユースケース名",
  "question": "テスト用の質問例",
  "answer": "期待される応答の説明"
}
```

### 重要な注意事項

⚠️ **推奨**: `ragtruth.jsonl`の`useCase`フィールドは、`agent-card.json`の`translations[].useCases`配列の値と一致する必要があります。

**セマンティックマッチング**:
1. **完全一致**: 文字列が完全に一致する場合（最優先）
2. **セマンティック類似度検索**: コサイン類似度を使用した意味的な類似性マッチング（閾値: 0.5）
3. **汎用フォールバック**: マッチしない場合、汎用的な期待値が自動生成されます

**特徴**:
- ✅ **柔軟なマッチング**: 表現が異なっても意味が近ければマッチします
  - 例: "フライト検索" ↔ "航空券を探す" (類似度: 0.6) → マッチ
  - 例: "フライト検索" ↔ "レストラン予約" (類似度: 0.1) → マッチせず
- ⚠️ **設定ミスの防止**: ランダム選択は行わず、意味的に近いもののみマッチ
- ℹ️ **自動フォールバック**: マッチしない場合でもテストは実行されます

### Agent Cardへの追加方法

1. **Agent Card (`agent-card.json`)の確認**:
   ```json
   {
     "translations": [
       {
         "locale": "ja",
         "useCases": [
           "国内線フライトの検索",
           "フライト価格の比較",
           "空席状況の確認"
         ]
       }
     ]
   }
   ```

2. **RAGTruth (`ragtruth.jsonl`)の作成**:
   - 各`useCase`に対応する行を追加
   - useCaseの値は完全一致が推奨されますが、意味的に類似していればマッチします
   - 期待される動作を`answer`フィールドに記述

3. **エージェント登録時の提供**:
   - Agent Cardと一緒に`ragtruth.jsonl`を提供
   - またはAgent Store APIの登録時にアップロード

### 例

現在の`ragtruth.jsonl`には、以下の3つのユースケースが定義されています：

```jsonl
{"useCase": "国内線フライトの検索", "question": "東京から大阪へのフライトを検索してください", "answer": "出発地と目的地を確認し、利用可能なフライト一覧（便名、時刻、価格、空席数）を提示します。"}
{"useCase": "フライト価格の比較", "question": "一番安いフライトはどれですか？", "answer": "複数のフライトの価格を比較し、最安値のフライトとその詳細（航空会社、時刻、空席状況）を提示します。"}
{"useCase": "空席状況の確認", "question": "各フライトの空席状況を教えてください", "answer": "各フライトの空席数を一覧形式で提示し、予約可能かどうかを明示します。"}
```

## 環境変数

- `OPENAI_API_KEY`: OpenAI APIキー（必須）
- `PORT`: サーバーポート（デフォルト: 4000）

## 起動方法

```bash
npm install
npm start
```

## Docker起動

```bash
docker compose up -d mock-agent
```
