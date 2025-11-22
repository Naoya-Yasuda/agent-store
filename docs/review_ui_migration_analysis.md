# Review UI 移行分析: 欠落している情報の洗い出し

## 概要

Python移行前のNode.js/TypeScript実装と現在のPython/Jinja2実装を比較し、review.htmlに欠落している詳細情報を特定します。

---

## 1. PreCheck ステージ

### 旧実装で表示していた情報
✅ `passed`: boolean
✅ `agentId`: string
✅ `agentRevisionId`: string (旧: `revision`)
✅ `errors`: string[]
✅ `warnings`: string[]

### 現在の実装で表示している情報
✅ `passed`: Status表示
✅ `agentId`: Agent ID表示
✅ `warnings`: 件数 + リスト表示
✅ `errors`: リスト表示

### ❌ 欠落情報
- **agentRevisionId**: Agent Cardから抽出したリビジョン番号
- **確認ポイント (registrantFocus)**:
  - 提出ID / エージェントIDが期待どおりか、PreCheck summary内の`agentId`・`revision`を確認
  - `warnings`が出ている場合はメッセージとカテゴリーを確認し、対応済みであることを記録
- **確認ポイント (adminFocus)**:
  - PreCheck summaryの食い違い（`summary.errors`や`warnings`）があればリトライし、Ledgerエントリを再送
  - 再提出が必要な場合は`precheck` stageから手動で再実行して`message`を更新

---

## 2. Security Gate ステージ

### 旧実装で表示していた情報
- **Summary**:
  ✅ `total`: 実行したテスト数
  ✅ `passed`: 成功数
  ✅ `failed`: 失敗数
  ✅ `error`: エラー数
  ❌ `categories`: カテゴリ別結果 `{ "jailbreak": { passed: 10, failed: 2 }, ... }`
  ❌ `needsReview`: レビューが必要かどうか
  ❌ `blocked`: ブロック数
  ❌ `notExecuted`: 未実行数

- **Artifacts**:
  ❌ `prompts`: 実行したプロンプト一覧（JSONL）
  ❌ `report`: 詳細レポート（禁止語検出、relayログのエラー）
  ❌ `metadata`: 実行メタデータ（実行時間、環境情報など）
  ❌ `summary`: サマリー情報（JSON）

- **Additional Context**:
  ❌ `endpoint`: エンドポイントURL
  ❌ `contextTerms`: コンテキスト用語（Agent Cardから抽出）
  ❌ `dataset`: 使用したデータセットパス

### 現在の実装で表示している情報
✅ `total`: Total Tests表示
✅ `passed`: Passed表示
✅ `failed`: Failed表示
✅ `error`: Errors表示

### ❌ 欠落情報
1. **カテゴリ別結果**: 攻撃タイプ別の成功/失敗数
2. **needsReview フラグ**: レビューが必要な項目があるか
3. **blocked/notExecuted カウント**: セキュリティブロック数と未実行数
4. **Artifacts リンク**:
   - Prompts アーティファクト（実行したプロンプト一覧）
   - Report アーティファクト（詳細レポート）
   - Metadata アーティファクト（実行環境情報）
5. **確認ポイント (registrantFocus)**:
   - Security summaryのカテゴリ別結果（`summary.categories`）と一覧に出力された`prompts`を確認し、想定した攻撃観点が網羅されているかを検証
   - Relayなどの`report`/`summary`で`needsReview`の有無とfail reasonsを確認
6. **確認ポイント (adminFocus)**:
   - 実行時のプロンプト（prompts artifact）とsecurity reportを開き、禁止語検出やrelayログのエラーをチェック
   - Security ledger entryが送信済みか、必要なら`ledger/resend`エンドポイントで再送

---

## 3. Functional Accuracy ステージ

### 旧実装で表示していた情報
- **Summary**:
  ✅ `total_scenarios` (旧: `scenarios`): 実行したシナリオ数
  ✅ `passed_scenarios` (旧: `passes` or `passed`): 成功数
  ✅ `failed_scenarios`: 失敗数
  ❌ `needsReview` (旧: `needs_review`): レビューが必要なシナリオ数
  ❌ `advbenchScenarios`: AdvBenchシナリオ数
  ❌ `advbenchLimit`: AdvBench制限数
  ❌ `averageDistance`: 平均距離（セマンティック類似度）
  ❌ `embeddingAverageDistance`: 埋め込み平均距離
  ❌ `embeddingMaxDistance`: 埋め込み最大距離
  ❌ `responsesWithError`: エラー応答数
  ❌ `ragtruthRecords`: RAGTruthレコード数

- **Artifacts**:
  ❌ `report`: 詳細レポート（topic/dialogue指標、errors、シナリオ別結果）
  ❌ `summary`: サマリー情報（JSON）
  ❌ `promptsArtifact`: プロンプト一覧（JSONL）

- **詳細表示 (旧実装の特別機能)**:
  ❌ **失敗シナリオ（上位3件）**: 距離スコアでソートした失敗シナリオの詳細
    - `scenarioId`: シナリオID
    - `verdict`: 判定結果
    - `distance`: 距離スコア
    - `topic_relevance`: トピック関連性
    - `dialogue_progress`: 対話進捗度
    - `prompt`: プロンプト
    - `expected`: 期待値
    - `errors`: エラー一覧
    - `rationale`: 判定理由

  ❌ **プロンプト/応答一覧テーブル**:
    - フィルタ機能（all/pass/needs_review/fail）
    - シナリオID（AdvBenchマーカー付き）
    - プロンプト
    - 応答
    - 判定結果
    - 上位10件表示

### 現在の実装で表示している情報
✅ `total_scenarios`: Total Scenarios表示
✅ `passed_scenarios`: Passed表示
✅ `failed_scenarios`: Failed表示

### ❌ 欠落情報
1. **needsReview カウント**: レビューが必要なシナリオ数
2. **AdvBench情報**:
   - `advbenchScenarios`: 実行したAdvBenchシナリオ数
   - `advbenchLimit`: 設定された制限数
3. **距離スコア**:
   - `averageDistance`: 平均距離
   - `embeddingAverageDistance`: 埋め込み平均距離
   - `embeddingMaxDistance`: 埋め込み最大距離
4. **エラー情報**:
   - `responsesWithError`: エラー応答数
5. **RAGTruth情報**:
   - `ragtruthRecords`: 使用したRAGTruthレコード数
6. **Artifacts リンク**:
   - Report アーティファクト（詳細レポート）
   - Summary アーティファクト（JSON）
   - Prompts アーティファクト（JSONL）
7. **失敗シナリオ詳細**: 上位3件の詳細情報（距離、topic_relevance、dialogue_progress、errors、rationale）
8. **プロンプト/応答一覧テーブル**: フィルタ可能な全シナリオのテーブル表示
9. **確認ポイント (registrantFocus)**:
   - Functional summaryに記載された`passes` / `needsReview`を確認し、AdvBenchを含むシナリオが期待どおりに取り込まれているか検証
   - Semantic距離（`averageDistance`, `embeddingAverageDistance`）やRAGTruth期待値との一致度をチェック
10. **確認ポイント (adminFocus)**:
    - Functional reportを開いてtopic/dialogue指標やerrorsを確認し、不具合があったシナリオをEvidenceとして保存
    - AdvBenchとAgentCardのシナリオ構成を確認し、summaryで`advbenchScenarios`が0でないことを確認

---

## 4. Judge Panel ステージ (未実装)

### 旧実装で表示していた情報
- **Summary**:
  - `taskCompletion`: タスク完了度スコア (0-100)
  - `tool`: ツール使用スコア (0-100)
  - `autonomy`: 自律性スコア (0-100)
  - `safety`: 安全性スコア (0-100)
  - `verdict`: 総合判定（`approved` | `rejected` | `manual`）
  - `manual`: 手動レビュー必要数
  - `reject`: 拒否数
  - `approve`: 承認数
  - `llmJudge`: LLM設定
    - `provider`: プロバイダー名
    - `model`: モデル名
    - `temperature`: 温度パラメータ
    - `maxOutputTokens`: 最大出力トークン数

- **Artifacts**:
  - `report`: 詳細レポート（各質問の詳細判定、LLM call count、rationale、思考チェーン）
  - `summary`: サマリー情報（JSON）
  - `relay`: Relayログ、エラー、禁止語チェック

### 現在の実装
❌ **Judge Panelステージは未実装**

### ❌ 欠落情報
**全ての情報が欠落** - Judge Panelステージ自体が未実装のため、すべての表示情報が必要

---

## 5. Human Review ステージ (未実装)

### 旧実装で表示していた情報
- **Summary**:
  - `decision`: 最終判定（`approved` | `rejected` | `manual`）
  - `reason`: 理由
  - `notes`: 追加メモ
  - `attachments`: 添付ファイル（参照したアーティファクト）
  - `decidedAt`: 判定日時

### 現在の実装
❌ **Human Reviewステージは未実装**

### ❌ 欠落情報
**全ての情報が欠落** - Human Reviewステージ自体が未実装のため、すべての表示情報が必要

---

## 6. Publish ステージ

### 旧実装で表示していた情報
- **Summary**:
  ✅ `trustScore`: 総合信頼スコア (0-100)
  ✅ `publishedAt`: 公開日時
  ✅ `status`: ステータス（`published`）

### 現在の実装で表示している情報
✅ `status`: Status表示
✅ `publishedAt`: Published At表示
✅ `trustScore`: Trust Score表示

### ❌ 欠落情報
- **確認ポイント (registrantFocus)**:
  - Publish stageが完了しているかと、`trustScore`がtarget（例: auto decision 80点以上）を満たしているかを確認
- **確認ポイント (adminFocus)**:
  - Publish時のledger entry / metadataを確認し、ドメイン公開時の情報を保存
  - 参考として`TrustScoreCard`に出るtotal scoreを記録

---

## 7. 全ステージ共通の欠落情報

### ステージ進捗バー
❌ **ステージ進捗バー**: 6つのステージをアイコン付きで視覚的に表示
- 🧾 PreCheck
- 🛡️ Security Gate
- 🧪 Functional Accuracy
- ⚖️ Judge Panel
- 🙋 Human Review
- 🚀 Publish

### ステージ状態表示
❌ **ステージステータス**:
- `status`: `completed` | `failed` | `running` | `pending`
- `message`: ステージメッセージ
- `attempts`: リトライ回数
- `warnings`: 警告一覧（ステージ固有）

### Ledger情報
❌ **Ledger情報**（全ステージ共通）:
- `ledger.entryPath`: Ledgerエントリパス
- `ledger.digest`: ダイジェスト
- `ledger.sourceFile`: ソースファイル
- `ledger.httpPosted`: HTTP送信済みフラグ
- `ledger.httpAttempts`: HTTP送信試行回数
- `ledger.httpError`: HTTPエラー

### WandB統合
❌ **WandB Run情報**:
- `wandbRun.url`: WandB実行URL（各ステージの実行ログへのリンク）

### Artifacts管理
❌ **Artifacts統一管理**:
- 各ステージのアーティファクトへのリンク
- `stage`: ステージ名
- `type`: アーティファクトタイプ（report, summary, prompts, metadata, relay）
- `agentRevisionId`: リビジョンID
- ダウンロードリンク: `/review/artifacts/{agentRevisionId}?stage={stage}&type={type}`

---

## 8. 優先度付きTODOリスト

### 🔴 高優先度（即時対応）

1. **ステージ進捗バー**: 6ステージの視覚的進捗表示
2. **Security Gate - カテゴリ別結果**: 攻撃タイプ別の詳細表示
3. **Functional Accuracy - 詳細メトリクス**:
   - needsReview, advbenchScenarios, averageDistance等
4. **Functional Accuracy - 失敗シナリオ詳細**: 上位3件の詳細表示
5. **Artifacts リンク**: 全ステージのアーティファクトダウンロードリンク

### 🟡 中優先度（近日対応）

6. **確認ポイント**: 各ステージのregistrantFocus/adminFocus表示
7. **ステージステータス**: status, message, attempts表示
8. **Functional Accuracy - プロンプト/応答テーブル**: フィルタ可能なテーブル表示
9. **Ledger情報**: 全ステージのLedger送信状況表示

### 🟢 低優先度（将来対応）

10. **Judge Panel ステージ実装**: 未実装ステージの追加
11. **Human Review ステージ実装**: 未実装ステージの追加
12. **WandB統合**: WandB RunへのリンクとMetrics表示

---

## 9. データ構造の比較

### 旧実装のデータ構造

```typescript
type ProgressResponse = {
  terminalState?: string;
  stages: Record<StageName, StageInfo>;
  wandbRun?: { url?: string };
  agentId?: string;
  agentRevisionId?: string;
  trustScore?: TrustScoreBreakdown;
  warnings?: Record<StageName, string[]>;
};

type StageInfo = {
  status?: 'completed' | 'failed' | 'running' | 'pending';
  warnings?: string[];
  message?: string;
  attempts?: number;
  details?: {
    summary?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    artifacts?: Record<string, ArtifactDescriptor>;
    reason?: string;
    ledger?: LedgerInfo;
  };
};

type ArtifactDescriptor = {
  stage: StageName | string;
  type: string;
  agentRevisionId: string;
  agentId?: string;
};
```

### 現在の実装のデータ構造

```python
class Submission(Base):
    state: str  # "submitted" | "precheck_passed" | "security_gate_completed" | etc.
    trust_score: int
    security_score: int
    functional_score: int
    judge_score: int
    implementation_score: int
    score_breakdown: dict  # JSON field
    auto_decision: str  # "auto_approved" | "auto_rejected" | "requires_human_review"
```

### 🔴 重要な差異

1. **旧実装**: ステージごとの詳細情報（status, attempts, warnings, message）を持つ
2. **現在**: `state`フィールドのみで、ステージごとの詳細情報なし
3. **旧実装**: `artifacts`がステージ別に構造化
4. **現在**: アーティファクトの管理が未実装

---

## 10. 実装推奨事項

### score_breakdownの拡張

現在の`score_breakdown`を以下のように拡張することを推奨:

```python
score_breakdown = {
  "precheck_summary": {
    "passed": True,
    "agentId": "...",
    "agentRevisionId": "v1",
    "errors": [],
    "warnings": []
  },
  "security_summary": {
    "total": 100,
    "passed": 90,
    "failed": 5,
    "error": 5,
    "blocked": 3,
    "needsReview": 2,
    "categories": {
      "jailbreak": { "passed": 20, "failed": 1 },
      "prompt_injection": { "passed": 30, "failed": 2 }
    },
    "endpoint": "http://...",
    "contextTerms": ["国内線フライトの検索", ...],
    "artifacts": {
      "prompts": "/artifacts/.../security/prompts.jsonl",
      "report": "/artifacts/.../security/report.json",
      "summary": "/artifacts/.../security/summary.json",
      "metadata": "/artifacts/.../security/metadata.json"
    }
  },
  "functional_summary": {
    "total_scenarios": 50,
    "passed_scenarios": 40,
    "failed_scenarios": 5,
    "needsReview": 5,
    "advbenchScenarios": 10,
    "advbenchLimit": 20,
    "averageDistance": 0.25,
    "embeddingAverageDistance": 0.18,
    "embeddingMaxDistance": 0.45,
    "responsesWithError": 3,
    "ragtruthRecords": 40,
    "artifacts": {
      "report": "/artifacts/.../functional/report.jsonl",
      "summary": "/artifacts/.../functional/summary.json",
      "prompts": "/artifacts/.../functional/prompts.jsonl"
    }
  },
  "judge_summary": {
    "taskCompletion": 85,
    "tool": 90,
    "autonomy": 75,
    "safety": 95,
    "verdict": "approved",
    "manual": 2,
    "reject": 0,
    "approve": 48,
    "llmJudge": {
      "provider": "google-adk",
      "model": "gemini-2.0-flash-exp",
      "temperature": 0.1,
      "maxOutputTokens": 512
    },
    "artifacts": {
      "report": "/artifacts/.../judge/report.json",
      "summary": "/artifacts/.../judge/summary.json",
      "relay": "/artifacts/.../judge/relay.log"
    }
  },
  "human_summary": {
    "decision": "approved",
    "reason": "Manual review completed",
    "notes": "All security concerns addressed",
    "decidedAt": "2025-11-22T12:00:00Z",
    "attachments": ["security/summary", "functional/summary", "judge/summary"]
  },
  "publish_summary": {
    "trustScore": 85,
    "publishedAt": "2025-11-22T12:30:00Z",
    "status": "published"
  },
  "stages": {
    "precheck": {
      "status": "completed",
      "attempts": 1,
      "message": "PreCheck passed successfully",
      "warnings": []
    },
    "security": {
      "status": "completed",
      "attempts": 1,
      "message": "Security Gate completed",
      "warnings": ["2 scenarios need manual review"]
    },
    "functional": {
      "status": "completed",
      "attempts": 1,
      "message": "Functional Accuracy completed",
      "warnings": ["5 scenarios need review"]
    },
    "judge": {
      "status": "completed",
      "attempts": 1,
      "message": "Judge Panel completed",
      "warnings": []
    },
    "human": {
      "status": "completed",
      "attempts": 1,
      "message": "Human review approved",
      "warnings": []
    },
    "publish": {
      "status": "completed",
      "attempts": 1,
      "message": "Agent published successfully",
      "warnings": []
    }
  },
  "wandb": {
    "url": "https://wandb.ai/..."
  },
  "ledger": {
    "precheck": {
      "entryPath": "/ledger/...",
      "digest": "sha256:...",
      "sourceFile": "precheck.json",
      "httpPosted": True,
      "httpAttempts": 1
    },
    "security": { ... },
    "functional": { ... },
    "judge": { ... }
  }
}
```

この構造により、旧実装と同等の詳細情報を提供できます。
