# LLM Judge Panel アンサンブル設計

**作成日**: 2025-11-14
**ステータス**: 提案中
**目的**: LLM as a Judgeのベストプラクティスに基づき、バイアスを軽減した信頼性の高い評価システムを設計

---

## 📚 背景: LLM as a Judge 研究の最新動向

### 主要な論文と知見

1. **"Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" (2023)**
   - LLM-as-a-Judgeの基礎手法を確立
   - 単一モデルによる評価の限界を指摘

2. **"Beyond Consensus: Mitigating the Agreeableness Bias" (arXiv 2024)**
   - 単純な多数決では「同意しやすいバイアス」が残る
   - 少数意見の尊重（Minority-Veto）の重要性

3. **"Evaluating and Mitigating LLM-as-a-judge Bias in Communication Systems" (arXiv 2024)**
   - Position Bias（応答順序バイアス）の実証
   - 回帰ベースのキャリブレーション手法の提案

### ベストプラクティス

| 課題 | 解決策 | 効果 |
|------|--------|------|
| **Self-Enhancement Bias** | 異なるモデルファミリーを使用 | 自己評価の過大評価を防止 |
| **Position Bias** | 応答順序をランダム化し平均化 | 順序による評価の偏りを軽減 |
| **Agreeableness Bias** | Minority-Veto戦略 | 明確な問題を見逃さない |
| **Calibration Error** | 少量の人間アノテーションで回帰モデル | 2倍の精度向上 |

---

## 🎯 現状の実装分析

### 現在の Judge Panel 構成

```python
# prototype/inspect-worker/inspect_worker/judge_orchestrator.py

class MCTSJudgeOrchestrator:
    def _evaluate_with_mcts(self, question, response):
        stages = ["plan", "counter", "reconcile"]  # 3つの視点
        for stage in stages:
            judge_score = self._single_judge_score(question, response, stage)
        final_score = score / len(stages)  # 単純平均
```

**現状の特徴:**
- ✅ 複数視点の評価（plan, counter, reconcile）
- ✅ LLM Judge統合（オプション）
- ❌ 単一LLMモデルのみ使用
- ❌ Position Biasの考慮なし
- ❌ キャリブレーション機能なし
- ❌ Minority-Veto戦略なし

---

## 🏗️ 改善設計: Multi-Model Ensemble Judge Panel

### アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────┐
│                 Judge Panel Orchestrator                  │
└──────────────────────────────────────────────────────────┘
                           ↓
        ┌──────────────────┴──────────────────┐
        │   Question Generation (unchanged)    │
        └──────────────────┬──────────────────┘
                           ↓
        ┌──────────────────────────────────────┐
        │   Execution Agent (unchanged)        │
        │   - A2A Relay経由で対象エージェント実行 │
        └──────────────────┬──────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────┐
│              Multi-Model Judge Ensemble                   │
├──────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Judge Agent │  │ Judge Agent │  │ Judge Agent │      │
│  │   Model A   │  │   Model B   │  │   Model C   │      │
│  │  (GPT-4o)   │  │(Claude 3.5) │  │ (Gemini)    │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │              │
│         └────────────────┴────────────────┘              │
│                          ↓                                │
│           ┌──────────────────────────┐                   │
│           │  Position Randomization  │                   │
│           │  (各モデルで2回評価)      │                   │
│           └──────────┬───────────────┘                   │
│                      ↓                                    │
│           ┌──────────────────────────┐                   │
│           │  Ensemble Aggregation    │                   │
│           │  - Minority-Veto         │                   │
│           │  - Weighted Voting       │                   │
│           │  - Confidence Scoring    │                   │
│           └──────────┬───────────────┘                   │
└────────────────────────────────────────────────────────┘
                       ↓
            ┌─────────────────────────┐
            │  Calibration Module     │
            │  (optional - 少量の人間  │
            │   アノテーションで調整)  │
            └──────────┬──────────────┘
                       ↓
            ┌─────────────────────────┐
            │  Final Verdict          │
            │  - score: 0.0-1.0       │
            │  - verdict: approve/    │
            │    manual/reject        │
            │  - confidence: 0.0-1.0  │
            │  - explanation: str     │
            └─────────────────────────┘
```

---

## 🔧 実装詳細

### 1. Multi-Model Judge Configuration

```python
@dataclass
class MultiModelJudgeConfig:
    models: List[ModelConfig]  # 複数モデル設定
    aggregation_strategy: str = "minority_veto"  # "majority", "weighted", "minority_veto"
    position_randomization: bool = True
    num_position_samples: int = 2
    calibration_enabled: bool = False
    calibration_data_path: Optional[str] = None

@dataclass
class ModelConfig:
    provider: str  # "openai", "anthropic", "google"
    model: str
    weight: float = 1.0  # アンサンブルでの重み
    temperature: float = 0.1
    max_output_tokens: int = 256
    base_url: Optional[str] = None
```

**推奨構成:**
```yaml
models:
  - provider: openai
    model: gpt-4o
    weight: 1.0
  - provider: anthropic
    model: claude-3-5-sonnet-20241022
    weight: 1.0
  - provider: google
    model: gemini-2.0-flash-exp
    weight: 0.8  # 実験的モデルなので重みを下げる
```

### 2. Position Bias Mitigation

```python
def evaluate_with_position_randomization(
    self,
    question: QuestionSpec,
    execution: ExecutionResult
) -> List[LLMJudgeResult]:
    """各モデルで応答位置をランダム化して評価"""
    results = []

    for model_config in self.config.models:
        for _ in range(self.config.num_position_samples):
            # プロンプトの順序をランダム化
            prompt = self._build_prompt_with_random_order(
                question, execution
            )
            result = self._evaluate_with_model(model_config, prompt)
            results.append(result)

    return results
```

### 3. Ensemble Aggregation Strategies

#### Strategy A: Majority Voting (基本)
```python
def aggregate_majority(results: List[LLMJudgeResult]) -> EnsembleResult:
    """多数決による判定"""
    verdict_counts = Counter(r.verdict for r in results)
    majority_verdict = verdict_counts.most_common(1)[0][0]
    confidence = verdict_counts[majority_verdict] / len(results)
    avg_score = mean(r.score for r in results if r.score is not None)

    return EnsembleResult(
        verdict=majority_verdict,
        score=avg_score,
        confidence=confidence,
        individual_results=results
    )
```

#### Strategy B: Minority-Veto (推奨)
```python
def aggregate_minority_veto(
    results: List[LLMJudgeResult],
    veto_threshold: float = 0.3
) -> EnsembleResult:
    """少数意見を尊重: 30%以上が reject なら reject"""
    reject_ratio = sum(1 for r in results if r.verdict == "reject") / len(results)

    if reject_ratio >= veto_threshold:
        # 重大な問題を1つでも検出したら reject
        return EnsembleResult(
            verdict="reject",
            score=0.0,
            confidence=reject_ratio,
            reasoning="Minority veto triggered: significant issues detected"
        )

    # それ以外は多数決
    return aggregate_majority(results)
```

#### Strategy C: Weighted Voting with Confidence
```python
def aggregate_weighted(
    results: List[LLMJudgeResult],
    model_weights: Dict[str, float]
) -> EnsembleResult:
    """モデルの重みと信頼度を考慮した加重投票"""
    weighted_scores = []
    total_weight = 0

    for result in results:
        weight = model_weights.get(result.model_id, 1.0)
        confidence = result.confidence if result.confidence else 1.0
        weighted_score = result.score * weight * confidence
        weighted_scores.append(weighted_score)
        total_weight += weight * confidence

    final_score = sum(weighted_scores) / total_weight
    verdict = _verdict_from_score(final_score)

    return EnsembleResult(
        verdict=verdict,
        score=final_score,
        confidence=_calculate_confidence(results),
        reasoning=_generate_explanation(results)
    )
```

### 4. Calibration Module (オプション)

```python
class CalibrationModule:
    """少量の人間アノテーションでLLM Judgeをキャリブレート"""

    def __init__(self, ground_truth_data: List[GroundTruthSample]):
        self.gt_data = ground_truth_data
        self.regression_model = None

    def train(self, llm_predictions: List[LLMJudgeResult]):
        """回帰モデルを学習"""
        # LLMスコアと人間評価の差分を学習
        X = np.array([[p.score, p.confidence] for p in llm_predictions])
        y = np.array([gt.human_score for gt in self.gt_data])

        self.regression_model = LinearRegression()
        self.regression_model.fit(X, y)

    def calibrate(self, raw_score: float, confidence: float) -> float:
        """生スコアをキャリブレート"""
        if not self.regression_model:
            return raw_score

        calibrated = self.regression_model.predict([[raw_score, confidence]])[0]
        return np.clip(calibrated, 0.0, 1.0)
```

---

## 📊 実装ロードマップ

### Phase 1: マルチモデル対応（優先度: 高）
- [ ] `MultiModelJudgeConfig` の実装
- [ ] 複数プロバイダーのクライアント実装（OpenAI, Anthropic, Google）
- [ ] エラーハンドリング（API制限、タイムアウト、フォールバック）
- [ ] コスト最適化（モデル選択、トークン制限）

### Phase 2: Position Bias対策（優先度: 高）
- [ ] プロンプト順序ランダム化の実装
- [ ] 複数回サンプリングと平均化
- [ ] 評価結果の分散計算（信頼度指標）

### Phase 3: Ensemble Aggregation（優先度: 高）
- [ ] Majority Voting実装
- [ ] Minority-Veto戦略実装
- [ ] Weighted Voting実装
- [ ] 信頼度スコアの算出

### Phase 4: Calibration機能（優先度: 中）
- [ ] Ground Truthデータ収集フォーマット定義
- [ ] 回帰ベースのキャリブレーション実装
- [ ] キャリブレーションデータの継続的更新

### Phase 5: モニタリングと改善（優先度: 低）
- [ ] Judge間の一致率（Inter-Judge Agreement）の可視化
- [ ] Position Biasの検出と報告
- [ ] モデルパフォーマンスのA/Bテスト

---

## 💰 コスト分析

### 現状（単一モデル）
- モデル: GPT-4o
- 1質問あたり評価: 1回
- 想定トークン: 入力500 + 出力100 = 600トークン
- コスト: $0.003 / 1K入力トークン + $0.015 / 1K出力トークン = **約$0.0027 per question**

### 提案（3モデルアンサンブル + Position Randomization）
- モデル: GPT-4o, Claude 3.5 Sonnet, Gemini 2.0 Flash
- 1質問あたり評価: 3モデル × 2回（位置ランダム化）= 6回
- 想定トークン: 600トークン × 6 = 3,600トークン
- コスト見積もり:
  - GPT-4o: $0.0027 × 2 = $0.0054
  - Claude 3.5 Sonnet: $0.003 × 2 = $0.006 (入力$3/MTok, 出力$15/MTok)
  - Gemini 2.0 Flash: $0.0001 × 2 = $0.0002 (入力$0.10/MTok, 出力$0.40/MTok)
- **合計: 約$0.0116 per question (約4.3倍)**

### コスト最適化案
1. **段階的評価**: 最初はGemini Flashで評価し、不確実性が高い場合のみ高コストモデルを追加
2. **キャッシュ活用**: 同一プロンプトはキャッシュして再利用
3. **バッチ処理**: 複数質問をまとめて評価

---

## 🧪 評価指標

### 1. Judge間一致率（Inter-Judge Agreement）
```python
def calculate_fleiss_kappa(judge_verdicts: List[List[str]]) -> float:
    """Fleiss' Kappaで複数Judge間の一致度を測定"""
    # 実装: statsmodels.stats.inter_rater.fleiss_kappa
    pass
```

### 2. Position Bias検出
```python
def detect_position_bias(results_by_position: Dict[int, List[float]]) -> float:
    """位置による評価の偏りを検出"""
    position_scores = [np.mean(scores) for scores in results_by_position.values()]
    return np.std(position_scores)  # 標準偏差が大きい = バイアス大
```

### 3. Calibration Error
```python
def calculate_calibration_error(
    predicted_scores: List[float],
    ground_truth_scores: List[float]
) -> float:
    """予測スコアと実際のスコアの誤差"""
    return mean_absolute_error(ground_truth_scores, predicted_scores)
```

---

## 🎯 推奨事項

### 即座に実装すべき（Phase 1-2）
1. **3モデルアンサンブル**: GPT-4o, Claude 3.5, Gemini 2.0 Flash
2. **Minority-Veto戦略**: 1つでも重大な問題を検出したら reject
3. **Position Randomization**: 各モデルで2回評価し平均化

### 中期的に実装（Phase 3-4）
4. **Weighted Voting**: モデルの信頼度に基づく加重投票
5. **Calibration**: 人間評価100件を収集しキャリブレーション

### 長期的改善（Phase 5）
6. **継続的モニタリング**: Judge間一致率、Position Biasの定期測定
7. **A/Bテスト**: アンサンブル戦略の比較評価
8. **コスト最適化**: 段階的評価、キャッシュ活用

---

## 🤖 LLM as a Judge によるエージェント評価の特殊性

### Agent-as-a-Judge フレームワーク

従来の「LLM as a Judge」は主に**単一ターンの応答品質**を評価する手法だが、エージェントハブでは**マルチターン対話型エージェント**の評価が必要。この場合、**Agent-as-a-Judge**フレームワークが有効：

#### 評価すべき4つの側面

1. **タスク完遂性 (Task Completion)**
   - エージェントがユースケースの目的を達成したか
   - 必要なステップを全て実行したか
   - 例: 「天気予報エージェント」が位置情報を取得し、APIを呼び出し、結果を返したか

2. **ツール使用の正確性 (Tool Correctness)**
   - 適切なツール/APIを選択したか
   - 引数が正しく渡されたか
   - エラーハンドリングができているか

3. **対話品質 (Conversation Quality)**
   - ユーザーの意図を正しく理解したか
   - 応答が自然で分かりやすいか
   - 必要な情報を適切に質問したか

4. **コンテキスト保持 (Memory Retention)**
   - 会話履歴を正しく参照しているか
   - 複数ターンにわたる情報を記憶しているか
   - トピック転換時に適切に対応しているか

### 現在の Judge Panel の評価範囲

```python
# prototype/inspect-worker/inspect_worker/judge_orchestrator.py
stages = ["plan", "counter", "reconcile"]
```

現在の実装では主に**単一ターンの応答品質**（対話品質の一部）のみ評価している。エージェント特有の評価（タスク完遂、ツール使用、コンテキスト保持）が不足。

### 推奨改善: エージェント評価用プロンプト設計

```python
def _build_agent_evaluation_prompt(
    self,
    use_case: str,
    conversation_history: List[Message],
    tool_usage: List[ToolCall],
    final_response: str
) -> str:
    """エージェント専用の評価プロンプト"""
    return f"""
You are evaluating an AI agent's performance on the following use case:
Use Case: {use_case}

Conversation History:
{format_conversation(conversation_history)}

Tool Usage Log:
{format_tool_calls(tool_usage)}

Final Response:
{final_response}

Evaluate the agent on these criteria (0-100 each):

1. Task Completion (0-40 points):
   - Did the agent accomplish the stated use case goal?
   - Were all necessary steps executed?
   - Score: [0-40]

2. Tool Correctness (0-30 points):
   - Were appropriate tools selected?
   - Were tool arguments correct?
   - Was error handling adequate?
   - Score: [0-30]

3. Conversation Quality (0-20 points):
   - Did the agent understand user intent?
   - Were responses clear and natural?
   - Did the agent ask appropriate clarifying questions?
   - Score: [0-20]

4. Context Retention (0-10 points):
   - Did the agent remember previous conversation context?
   - Did it handle topic transitions appropriately?
   - Score: [0-10]

Provide your evaluation in JSON format:
{{
  "task_completion": <score>,
  "tool_correctness": <score>,
  "conversation_quality": <score>,
  "context_retention": <score>,
  "total_score": <sum>,
  "verdict": "approve" | "reject" | "manual",
  "reasoning": "<detailed explanation>"
}}
"""
```

### 実装優先度

#### Phase 1（既存Judge Panelの改善 - まず実装すべき）:
1. **エージェント評価用プロンプトへの置き換え**
   - 現在の`plan/counter/reconcile`を廃止
   - 上記の4側面評価プロンプトに変更
   - 単一モデルでも評価精度が向上

#### Phase 2（Multi-Model Ensemble - 次に実装）:
2. **3モデルアンサンブル**（本ドキュメントのPhase 1-3）
3. **Position Randomization**
4. **Minority-Veto戦略**

#### Phase 3（高度な機能 - 将来的に実装）:
5. **Calibration**（人間評価100件でキャリブレーション）
6. **継続的モニタリング**

---

## 📝 参考文献

1. Zheng et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"
2. arXiv 2024. "Beyond Consensus: Mitigating the Agreeableness Bias in LLM Judge Evaluations"
3. arXiv 2024. "Evaluating and Mitigating LLM-as-a-judge Bias in Communication Systems"
4. Cameron R. Wolfe. "Using LLMs for Evaluation" (Substack blog)
5. **Agent-as-a-Judge Framework**: Survey on evaluating LLM-based agents for multi-turn conversations (2024)
6. **Multi-Turn Agent Evaluation**: Task completion, tool correctness, conversation quality, memory retention

---

## 🔗 関連ドキュメント

- [信頼性スコア実装ロードマップ](./trust-score-implementation-roadmap.md)
- [Judge Panel実装ガイド](./judge-panel-human-review-implementation-20251110.md)
- [Review Pipeline Workflow](../../prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts)
- [LLM Judge実装](../../prototype/inspect-worker/inspect_worker/llm_judge.py)
