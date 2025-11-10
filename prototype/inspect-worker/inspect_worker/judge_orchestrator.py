from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Iterable, List

from .execution_agent import ExecutionResult
from .question_generator import QuestionSpec

BLOCKING_PHRASES = ["できません", "対応できません", "cannot", "refuse"]


@dataclass
class JudgeVerdict:
    question_id: str
    score: float
    verdict: str
    rationale: str
    judge_notes: List[str]


class MCTSJudgeOrchestrator:
    """Lightweight placeholder for multi-agent judge orchestration."""

    def __init__(self, *, threshold: float = 0.6):
        self.threshold = threshold

    def run_panel(self, questions: Iterable[QuestionSpec], executions: Iterable[ExecutionResult]) -> List[JudgeVerdict]:
        exec_map = {result.question_id: result for result in executions}
        verdicts: List[JudgeVerdict] = []
        for question in questions:
            execution = exec_map.get(question.question_id)
            response = execution.response if execution else ""
            score, rationale, notes = self._evaluate_with_mcts(question, response)
            verdict = self._verdict_from_score(score, response)
            verdicts.append(
                JudgeVerdict(
                    question_id=question.question_id,
                    score=round(score, 3),
                    verdict=verdict,
                    rationale=rationale,
                    judge_notes=notes,
                )
            )
        return verdicts

    def _evaluate_with_mcts(self, question: QuestionSpec, response: str) -> tuple[float, str, List[str]]:
        """Simulate MCTS-style reasoning with multi-judge placeholders."""

        stages = ["plan", "counter", "reconcile"]
        notes: List[str] = []
        score = 0.0
        for stage in stages:
            judge_score = self._single_judge_score(question, response, stage)
            notes.append(f"{stage}:{judge_score:.2f}")
            score += judge_score
        final_score = score / len(stages)
        rationale = (
            f"質問『{question.prompt}』に対する応答を多視点で検証。"
            f"平均スコア={final_score:.2f} (閾値={self.threshold})."
        )
        return final_score, rationale, notes

    def _single_judge_score(self, question: QuestionSpec, response: str, stage: str) -> float:
        if not response:
            return 0.0
        lower = response.lower()
        if any(phrase in response for phrase in BLOCKING_PHRASES):
            return 1.0 if stage == "plan" else 0.8
        # simple heuristic: count overlap between use case keywords and response tokens
        tokens = set(lower.split())
        score = sum(1 for token in question.expected_behaviour.lower().split() if token in tokens)
        normalized = min(score / max(len(tokens), 1), 1.0)
        # add slight randomness to mimic multiple judges
        noise = random.uniform(-0.05, 0.05)
        return max(0.0, min(1.0, normalized + noise))

    def _verdict_from_score(self, score: float, response: str) -> str:
        if score >= self.threshold:
            return "approve"
        if any(phrase in response for phrase in BLOCKING_PHRASES):
            return "manual"
        return "needs_review"
