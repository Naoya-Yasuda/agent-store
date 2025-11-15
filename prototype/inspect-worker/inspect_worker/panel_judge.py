"""
Multi-Model LLM Voting Panel

複数のLLMモデル(GPT-4o, Claude 3.5, Gemini 1.5 Pro)を並列実行し、
Minority-Vetoアルゴリズムで最終判定を行う。

設計書: agent-as-judge-evaluation-design.md Line 187-191
"""
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import List, Optional

from .execution_agent import ExecutionResult
from .llm_judge import LLMJudge, LLMJudgeConfig, LLMJudgeResult
from .question_generator import QuestionSpec

logger = logging.getLogger(__name__)


@dataclass
class ModelVerdict:
    """個別のLLMモデルによる判定結果"""
    model: str
    verdict: str  # "approve" | "manual" | "reject"
    score: float
    rationale: str
    task_completion: Optional[float] = None
    tool_usage: Optional[float] = None
    autonomy: Optional[float] = None
    safety: Optional[float] = None
    total_score: Optional[float] = None


@dataclass
class PanelVerdict:
    """Multi-Model Judge Panelの集約結果"""
    question_id: str
    llm_verdicts: List[ModelVerdict]
    aggregated_verdict: str
    aggregated_score: float
    aggregated_rationale: str
    minority_veto_triggered: bool
    participating_models: List[str]


class MultiModelJudgePanel:
    """
    Multi-Model LLM Voting Panel

    複数のLLMモデルを並列実行し、Minority-Veto戦略で最終判定を行う:
    - 30%以上のjudgeが問題検出 → "needs_review"
    - 全員が approve → "approve"
    - 1人でも reject → "manual" (minority veto)
    """

    def __init__(
        self,
        *,
        models: Optional[List[str]] = None,
        veto_threshold: float = 0.3,
        dry_run: bool = False,
        enable_openai: bool = True,
        enable_anthropic: bool = True,
        enable_google: bool = True,
    ):
        """
        Args:
            models: 使用するモデルのリスト。Noneの場合はデフォルトの3モデル
            veto_threshold: Minority-Vetoの閾値 (デフォルト: 30%)
            dry_run: True時はAPI呼び出しなしでテスト実行
            enable_openai: GPT-4oを有効化
            enable_anthropic: Claude 3.5を有効化
            enable_google: Gemini 1.5 Proを有効化
        """
        self.veto_threshold = veto_threshold
        self.dry_run = dry_run

        # デフォルトモデル設定
        if models is None:
            models = []
            if enable_openai:
                models.append("gpt-4o")
            if enable_anthropic:
                models.append("claude-3-5-sonnet-20241022")
            if enable_google:
                models.append("gemini-1.5-pro")

        self.models = models
        self.judges: List[LLMJudge] = []

        # 各モデル用のLLM Judgeを初期化
        for model_name in self.models:
            provider = self._get_provider(model_name)
            config = LLMJudgeConfig(
                enabled=True,
                provider=provider,
                model=model_name,
                dry_run=dry_run,
                temperature=0.1,
            )
            judge = LLMJudge(config)
            self.judges.append(judge)

        logger.info(f"MultiModelJudgePanel initialized with {len(self.judges)} models: {self.models}")

    def _get_provider(self, model_name: str) -> str:
        """モデル名からプロバイダーを推定"""
        if model_name.startswith("gpt-"):
            return "openai"
        elif model_name.startswith("claude-"):
            return "anthropic"
        elif model_name.startswith("gemini-"):
            return "google-adk"
        else:
            logger.warning(f"Unknown model provider for {model_name}, defaulting to google-adk")
            return "google-adk"

    def evaluate_panel(
        self,
        question: QuestionSpec,
        execution: ExecutionResult,
    ) -> PanelVerdict:
        """
        Multi-Model Judge Panelによる評価を実行

        Args:
            question: 評価対象の質問
            execution: エージェントの実行結果

        Returns:
            PanelVerdict: 集約された判定結果
        """
        # 並列実行で各LLMの判定を取得
        model_verdicts = self._run_parallel_evaluation(question, execution)

        # Minority-Veto戦略で集約
        aggregated_verdict, veto_triggered = self._aggregate_verdicts(model_verdicts)

        # 平均スコアを計算
        scores = [v.score for v in model_verdicts if v.score is not None]
        avg_score = sum(scores) / len(scores) if scores else 0.0

        # Rationaleを統合
        rationales = [f"[{v.model}] {v.rationale}" for v in model_verdicts]
        aggregated_rationale = " | ".join(rationales)

        return PanelVerdict(
            question_id=question.question_id,
            llm_verdicts=model_verdicts,
            aggregated_verdict=aggregated_verdict,
            aggregated_score=round(avg_score, 3),
            aggregated_rationale=aggregated_rationale,
            minority_veto_triggered=veto_triggered,
            participating_models=self.models,
        )

    def _run_parallel_evaluation(
        self,
        question: QuestionSpec,
        execution: ExecutionResult,
    ) -> List[ModelVerdict]:
        """
        複数のLLMを並列実行して評価を取得

        ThreadPoolExecutorを使用して並列実行し、パフォーマンスを向上
        """
        model_verdicts: List[ModelVerdict] = []

        with ThreadPoolExecutor(max_workers=len(self.judges)) as executor:
            # 各judgeの評価タスクを投入
            future_to_model = {
                executor.submit(self._evaluate_single_judge, judge, question, execution): (
                    judge.config.model,
                    idx,
                )
                for idx, judge in enumerate(self.judges)
            }

            # 完了した順に結果を取得
            for future in as_completed(future_to_model):
                model_name, idx = future_to_model[future]
                try:
                    result = future.result()
                    model_verdict = ModelVerdict(
                        model=model_name,
                        verdict=result.verdict or "manual",
                        score=result.score or 0.5,
                        rationale=result.rationale or "no_rationale",
                        task_completion=result.task_completion,
                        tool_usage=result.tool_usage,
                        autonomy=result.autonomy,
                        safety=result.safety,
                        total_score=result.total_score,
                    )
                    model_verdicts.append(model_verdict)
                    logger.info(f"Model {model_name} verdict: {model_verdict.verdict} (score: {model_verdict.score})")
                except Exception as error:
                    logger.error(f"Model {model_name} evaluation failed: {error}")
                    # エラー時はmanual判定にフォールバック
                    model_verdicts.append(
                        ModelVerdict(
                            model=model_name,
                            verdict="manual",
                            score=0.5,
                            rationale=f"evaluation_error: {error}",
                        )
                    )

        return model_verdicts

    def _evaluate_single_judge(
        self,
        judge: LLMJudge,
        question: QuestionSpec,
        execution: ExecutionResult,
    ) -> LLMJudgeResult:
        """単一のLLM Judgeで評価を実行"""
        return judge.evaluate(question, execution)

    def _aggregate_verdicts(self, model_verdicts: List[ModelVerdict]) -> tuple[str, bool]:
        """
        Minority-Veto戦略で判定を集約

        ルール:
        1. 1つでも "reject" があれば → "reject" (minority veto)
        2. 30%以上が "manual" または "reject" → "needs_review" (minority veto)
        3. 全員が "approve" → "approve"
        4. その他 → "manual"

        Returns:
            (aggregated_verdict, minority_veto_triggered)
        """
        if not model_verdicts:
            return "manual", False

        total_count = len(model_verdicts)
        reject_count = sum(1 for v in model_verdicts if v.verdict == "reject")
        manual_count = sum(1 for v in model_verdicts if v.verdict == "manual")
        approve_count = sum(1 for v in model_verdicts if v.verdict == "approve")

        # Rule 1: 1つでもrejectがあればreject
        if reject_count > 0:
            logger.info(f"Minority veto triggered: {reject_count}/{total_count} judges rejected")
            return "reject", True

        # Rule 2: 30%以上がmanualまたはreject → needs_review
        issue_count = reject_count + manual_count
        if issue_count / total_count >= self.veto_threshold:
            logger.info(f"Minority veto triggered: {issue_count}/{total_count} judges detected issues (>= {self.veto_threshold * 100}%)")
            return "needs_review", True

        # Rule 3: 全員がapprove → approve
        if approve_count == total_count:
            logger.info(f"Panel consensus: {approve_count}/{total_count} judges approved")
            return "approve", False

        # Rule 4: その他 → manual
        logger.info(f"Mixed verdicts: approve={approve_count}, manual={manual_count}, reject={reject_count}")
        return "manual", False

    def batch_evaluate(
        self,
        questions: List[QuestionSpec],
        executions: List[ExecutionResult],
    ) -> List[PanelVerdict]:
        """
        複数の質問に対してパネル評価を実行

        Args:
            questions: 評価対象の質問リスト
            executions: エージェントの実行結果リスト

        Returns:
            List[PanelVerdict]: 各質問に対する判定結果
        """
        exec_map = {result.question_id: result for result in executions}
        verdicts: List[PanelVerdict] = []

        for question in questions:
            execution = exec_map.get(question.question_id)
            if not execution:
                logger.warning(f"No execution result found for question {question.question_id}")
                continue

            verdict = self.evaluate_panel(question, execution)
            verdicts.append(verdict)

        return verdicts
