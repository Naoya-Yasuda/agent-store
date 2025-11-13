# Phase 4: Calibration & Continuous Monitoring - 今後の展望

**ステータス**: 未実装 (将来のロードマップ)
**作成日**: 2025-11-14
**優先度**: 中 (Phase 1-3完了後に実装)

---

## 概要

Phase 1-3でAISI Inspect基準、マルチモデルアンサンブル、ベンチマークテストケースの実装が完了しました。Phase 4では、LLM Judgeの評価精度を**人間評価**と照合してキャリブレーションし、継続的な品質改善を行います。

---

## Phase 4の目標

1. **Calibration (キャリブレーション)**
   - LLMスコアと人間評価の差分を学習
   - 回帰モデルによるスコア補正
   - 評価の客観性と一貫性の向上

2. **Continuous Monitoring (継続的モニタリング)**
   - Judge間一致率(Inter-Judge Agreement)の測定
   - Position Biasの定期的な検出
   - モデルパフォーマンスのA/Bテスト

3. **Feedback Loop (フィードバックループ)**
   - 人間レビュアーからのフィードバック収集
   - Ground Truthデータの継続的な蓄積
   - モデルの定期的な再キャリブレーション

---

## 実装計画

### 1. Ground Truth データ収集

**目的**: 人間評価を収集してLLM評価との差分を測定

**データ構造**:
```typescript
interface GroundTruthRecord {
  submission_id: string;
  question_id: string;
  agent_response: string;

  // 人間評価者による評価
  human_evaluator_id: string;
  human_task_completion: number;  // 0-40
  human_tool_usage: number;       // 0-30
  human_autonomy: number;          // 0-20
  human_safety: number;            // 0-10
  human_total_score: number;       // 0-100
  human_verdict: string;           // approve/manual/reject
  human_rationale: string;

  // LLM評価(比較用)
  llm_task_completion: number;
  llm_tool_usage: number;
  llm_autonomy: number;
  llm_safety: number;
  llm_total_score: number;
  llm_verdict: string;

  // メタデータ
  evaluated_at: timestamp;
  confidence: number;              // 人間評価者の確信度 (1-5)
}
```

**収集方法**:
- Review UIに「Ground Truth評価モード」を追加
- 各submission IDに対して複数の人間評価者がAISI基準で評価
- 最低100件のGround Truthデータを目標に収集

**データベーススキーマ**:
```sql
CREATE TABLE ground_truth_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  question_id TEXT NOT NULL,
  agent_response TEXT NOT NULL,

  -- 人間評価
  human_evaluator_id UUID NOT NULL REFERENCES users(id),
  human_task_completion FLOAT NOT NULL CHECK (human_task_completion >= 0 AND human_task_completion <= 40),
  human_tool_usage FLOAT NOT NULL CHECK (human_tool_usage >= 0 AND human_tool_usage <= 30),
  human_autonomy FLOAT NOT NULL CHECK (human_autonomy >= 0 AND human_autonomy <= 20),
  human_safety FLOAT NOT NULL CHECK (human_safety >= 0 AND human_safety <= 10),
  human_total_score FLOAT NOT NULL CHECK (human_total_score >= 0 AND human_total_score <= 100),
  human_verdict TEXT NOT NULL CHECK (human_verdict IN ('approve', 'manual', 'reject')),
  human_rationale TEXT,
  confidence INT NOT NULL CHECK (confidence >= 1 AND confidence <= 5),

  -- LLM評価
  llm_task_completion FLOAT,
  llm_tool_usage FLOAT,
  llm_autonomy FLOAT,
  llm_safety FLOAT,
  llm_total_score FLOAT,
  llm_verdict TEXT,

  evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_ground_truth_submission ON ground_truth_evaluations(submission_id);
CREATE INDEX idx_ground_truth_evaluator ON ground_truth_evaluations(human_evaluator_id);
```

---

### 2. Calibration実装

**目的**: LLMスコアを人間評価に近づけるように補正

**アルゴリズム**: 線形回帰による補正

```python
from sklearn.linear_model import LinearRegression
import numpy as np

class JudgeCalibrator:
    """LLM Judge評価のキャリブレーション"""

    def __init__(self):
        self.regression_model: Optional[LinearRegression] = None
        self.feature_models: Dict[str, LinearRegression] = {}

    def train(self, ground_truth_data: List[GroundTruthRecord]):
        """
        Ground Truthデータから回帰モデルを学習

        Features: LLMスコア (task_completion, tool_usage, autonomy, safety)
        Target: 人間評価スコア
        """
        # 全体スコアの補正モデル
        X = np.array([
            [gt.llm_task_completion, gt.llm_tool_usage, gt.llm_autonomy, gt.llm_safety]
            for gt in ground_truth_data
        ])
        y = np.array([gt.human_total_score for gt in ground_truth_data])

        self.regression_model = LinearRegression()
        self.regression_model.fit(X, y)

        # 各基準ごとの補正モデル
        for criterion in ["task_completion", "tool_usage", "autonomy", "safety"]:
            X_criterion = np.array([
                [getattr(gt, f"llm_{criterion}")]
                for gt in ground_truth_data
            ])
            y_criterion = np.array([
                getattr(gt, f"human_{criterion}")
                for gt in ground_truth_data
            ])

            model = LinearRegression()
            model.fit(X_criterion, y_criterion)
            self.feature_models[criterion] = model

    def calibrate(self, llm_result: LLMJudgeResult) -> LLMJudgeResult:
        """LLM評価結果をキャリブレート"""
        if not self.regression_model:
            return llm_result

        # 各基準をキャリブレート
        calibrated_task = self._calibrate_score(
            llm_result.task_completion,
            self.feature_models["task_completion"],
            min_val=0, max_val=40
        )
        calibrated_tool = self._calibrate_score(
            llm_result.tool_usage,
            self.feature_models["tool_usage"],
            min_val=0, max_val=30
        )
        calibrated_autonomy = self._calibrate_score(
            llm_result.autonomy,
            self.feature_models["autonomy"],
            min_val=0, max_val=20
        )
        calibrated_safety = self._calibrate_score(
            llm_result.safety,
            self.feature_models["safety"],
            min_val=0, max_val=10
        )

        calibrated_total = calibrated_task + calibrated_tool + calibrated_autonomy + calibrated_safety

        return LLMJudgeResult(
            score=calibrated_total / 100.0,
            verdict=llm_result.verdict,
            rationale=f"{llm_result.rationale} [Calibrated]",
            raw=llm_result.raw,
            task_completion=calibrated_task,
            tool_usage=calibrated_tool,
            autonomy=calibrated_autonomy,
            safety=calibrated_safety,
            total_score=calibrated_total,
        )

    def _calibrate_score(self, raw_score: float, model: LinearRegression, min_val: float, max_val: float) -> float:
        """単一スコアをキャリブレート"""
        if not model:
            return raw_score

        calibrated = model.predict([[raw_score]])[0]
        return np.clip(calibrated, min_val, max_val)
```

---

### 3. Judge間一致率の測定

**目的**: 複数のJudge(モデル)間の一致度を測定し、信頼性を評価

**指標**: Fleiss' Kappa

```python
from statsmodels.stats.inter_rater import fleiss_kappa

def calculate_judge_agreement(verdicts_matrix: List[List[str]]) -> float:
    """
    Fleiss' Kappaで複数Judge間の一致度を測定

    Args:
        verdicts_matrix: [
            ["approve", "approve", "manual"],  # Submission 1
            ["reject", "reject", "reject"],     # Submission 2
            ["manual", "approve", "manual"],    # Submission 3
        ]

    Returns:
        Kappa score (0-1, higher = better agreement)
    """
    # Convert verdicts to numerical matrix
    categories = ["approve", "manual", "reject"]
    numerical_matrix = []

    for verdicts in verdicts_matrix:
        counts = [verdicts.count(cat) for cat in categories]
        numerical_matrix.append(counts)

    return fleiss_kappa(numerical_matrix)
```

**目標値**:
- Kappa > 0.6: 中程度の一致 (Moderate Agreement)
- Kappa > 0.8: 高い一致 (Substantial Agreement)

---

### 4. Position Bias検出

**目的**: 評価基準の提示順序によるバイアスを検出

```python
def detect_position_bias(results_by_position: Dict[int, List[float]]) -> Dict[str, Any]:
    """
    位置による評価の偏りを検出

    Args:
        results_by_position: {
            0: [85.2, 87.1, 83.5, ...],  # Criterion A が最初の位置
            1: [79.3, 81.2, 78.8, ...],  # Criterion A が2番目の位置
            2: [82.5, 84.1, 81.9, ...],  # Criterion A が3番目の位置
        }

    Returns:
        {
            "bias_detected": True/False,
            "position_scores": {0: 85.3, 1: 79.8, 2: 82.8},
            "std_deviation": 2.75,
            "severity": "high/medium/low"
        }
    """
    position_scores = {pos: np.mean(scores) for pos, scores in results_by_position.items()}
    std_dev = np.std(list(position_scores.values()))

    # 標準偏差が大きい = バイアス大
    severity = "low"
    if std_dev > 5.0:
        severity = "high"
    elif std_dev > 2.0:
        severity = "medium"

    return {
        "bias_detected": std_dev > 2.0,
        "position_scores": position_scores,
        "std_deviation": std_dev,
        "severity": severity,
    }
```

---

### 5. A/Bテスト

**目的**: 異なるアンサンブル戦略を比較評価

```python
class ABTestRunner:
    """アンサンブル戦略のA/Bテスト"""

    def run_ab_test(
        self,
        test_cases: List[BenchmarkTestCase],
        strategy_a: str,  # "minority_veto"
        strategy_b: str,  # "weighted"
    ) -> Dict[str, Any]:
        """
        2つの戦略を同じテストケースで比較

        Returns:
            {
                "strategy_a": {
                    "name": "minority_veto",
                    "pass_rate": 0.82,
                    "avg_agreement": 0.75,
                    "avg_confidence": 0.68,
                },
                "strategy_b": {
                    "name": "weighted",
                    "pass_rate": 0.79,
                    "avg_agreement": 0.71,
                    "avg_confidence": 0.72,
                },
                "winner": "strategy_a",
                "statistical_significance": 0.03  # p-value
            }
        """
        # 実装は省略
        pass
```

---

### 6. ダッシュボード

**目的**: キャリブレーションとモニタリング結果を可視化

**表示内容**:
- Judge間一致率の推移グラフ
- LLMスコア vs 人間評価スコアの散布図
- Position Biasの検出レポート
- A/Bテスト結果の比較表
- Ground Truthデータ収集進捗

---

## 実装優先度

### 最優先 (Phase 4-1)
- [ ] Ground Truthデータ収集のUI実装
- [ ] データベーススキーマの追加

### 高優先度 (Phase 4-2)
- [ ] 基本的なCalibration実装(線形回帰)
- [ ] Judge間一致率の測定(Fleiss' Kappa)

### 中優先度 (Phase 4-3)
- [ ] Position Bias検出
- [ ] A/Bテスト機能

### 低優先度 (Phase 4-4)
- [ ] ダッシュボードUI
- [ ] 継続的な再キャリブレーション

---

## 期待される効果

1. **評価精度の向上**
   - LLMスコアが人間評価に近づく
   - 主観的なバイアスの軽減

2. **信頼性の向上**
   - Judge間一致率の可視化
   - Position Biasの検出と軽減

3. **継続的改善**
   - Ground Truthデータの蓄積
   - モデルの定期的な再学習

4. **透明性**
   - 評価プロセスの可視化
   - ステークホルダーへの説明責任

---

## 参考文献

1. Zheng et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"
2. Fleiss, J. L. (1971). "Measuring nominal scale agreement among many raters"
3. scikit-learn LinearRegression: https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html
4. statsmodels Fleiss' Kappa: https://www.statsmodels.org/stable/generated/statsmodels.stats.inter_rater.fleiss_kappa.html

---

## 関連ドキュメント

- [Phase 1-3実装完了レポート](./llm-judge-panel-ensemble-design.md)
- [Trust Score Implementation Roadmap](./trust-score-implementation-roadmap.md)
- [Review Pipeline Workflow](../../prototype/temporal-review-workflow/src/workflows/reviewPipeline.workflow.ts)
