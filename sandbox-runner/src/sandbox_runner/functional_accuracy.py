from __future__ import annotations

import json
import logging
import math
import os
import random
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .security_gate import invoke_endpoint

logger = logging.getLogger(__name__)


@dataclass
class Scenario:
  id: str
  locale: str
  use_case: str
  prompt: str
  expected_answer: str


def load_agent_card(path: Path) -> Dict[str, Any]:
  with path.open(encoding="utf-8") as f:
    return json.load(f)


def select_translation(card: Dict[str, Any]) -> Dict[str, Any]:
  translations: List[Dict[str, Any]] = card.get("translations", [])
  default_locale = card.get("defaultLocale")
  if default_locale:
    for item in translations:
      if item.get("locale") == default_locale:
        return item
  return translations[0] if translations else {}


def generate_scenarios(card: Dict[str, Any], *, agent_id: str, revision: str, max_scenarios: int) -> List[Scenario]:
  translation = select_translation(card)
  locale = translation.get("locale", card.get("defaultLocale", "ja-JP"))
  use_cases: List[str] = translation.get("useCases", [])
  if not use_cases:
    # fallback to capabilities if no useCases
    use_cases = translation.get("capabilities", [])
  scenarios: List[Scenario] = []
  for idx, use_case in enumerate(use_cases[:max_scenarios]):
    prompt = f"{use_case} に関するユーザーの質問に回答してください。"
    scenarios.append(
      Scenario(
        id=f"{agent_id}-{revision}-scn-{idx+1}",
        locale=locale,
        use_case=use_case,
        prompt=prompt,
        expected_answer=""
      )
    )
  return scenarios


def load_ragtruth(dir_path: Path) -> List[Dict[str, Any]]:
  records: List[Dict[str, Any]] = []
  if not dir_path.exists():
    return records
  for jsonl_file in dir_path.glob("*.jsonl"):
    with jsonl_file.open(encoding="utf-8") as f:
      for line in f:
        line = line.strip()
        if not line:
          continue
        try:
          record = json.loads(line)
          records.append(record)
        except json.JSONDecodeError:
          continue
  return records


def tokenize(text: str) -> List[str]:
  """Tokenize text for similarity calculations."""
  return [token for token in text.lower().split() if token]


def semantic_similarity(text1: str, text2: str) -> float:
  """
  Calculate semantic similarity using simple token-based cosine similarity.
  This is a lightweight alternative to full embedding models.
  Returns a value between 0 (completely different) and 1 (identical).
  """
  tokens1 = Counter(tokenize(text1))
  tokens2 = Counter(tokenize(text2))

  if not tokens1 or not tokens2:
    return 0.0

  all_tokens = set(tokens1.keys()) | set(tokens2.keys())
  dot = sum(tokens1[token] * tokens2[token] for token in all_tokens)
  norm1 = math.sqrt(sum(count * count for count in tokens1.values()))
  norm2 = math.sqrt(sum(count * count for count in tokens2.values()))

  if norm1 == 0 or norm2 == 0:
    return 0.0

  return dot / (norm1 * norm2)


def attach_expected_answers(scenarios: List[Scenario], ragtruth: List[Dict[str, Any]]) -> None:
  """
  Attach expected answers to scenarios using semantic similarity matching.

  Matching strategy:
  1. Try exact string match first (fast path)
  2. Use semantic similarity to find best match (threshold: 0.5)
  3. If no good match, use generic fallback

  Note: Does NOT randomly select from ragtruth to avoid masking configuration errors.
  """
  SIMILARITY_THRESHOLD = 0.5  # Minimum similarity to consider a match

  for scenario in scenarios:
    # Try exact match first (fast path)
    matched = next((r for r in ragtruth if r.get("useCase") == scenario.use_case), None)

    # If no exact match, use semantic similarity to find best match
    if not matched and ragtruth:
      best_match = None
      best_similarity = 0.0

      for record in ragtruth:
        ragtruth_use_case = record.get("useCase", "")
        if not ragtruth_use_case:
          continue

        similarity = semantic_similarity(scenario.use_case, ragtruth_use_case)

        if similarity > best_similarity:
          best_similarity = similarity
          best_match = record

      # Only use the match if similarity is above threshold
      if best_match and best_similarity >= SIMILARITY_THRESHOLD:
        matched = best_match

    # Use matched answer or generate a generic expected answer
    # Do NOT randomly select from ragtruth - this masks configuration errors
    answer = matched.get("answer") if matched else f"期待される回答: {scenario.use_case} を丁寧に説明する。"
    scenario.expected_answer = answer or ""


def simple_similarity(a: str, b: Optional[str]) -> float:
  a_tokens = set((a or '').lower().split())
  b_tokens = set((b or '').lower().split())
  if not a_tokens and not b_tokens:
    return 1.0
  if not a_tokens or not b_tokens:
    return 0.0
  intersection = len(a_tokens & b_tokens)
  union = len(a_tokens | b_tokens)
  return intersection / union


class AgentResponseEvaluator:
  """
  Google ADKを使用したエージェントベース評価器。
  LLMを推論ツールとして使用し、多段階評価プロセスを実行。
  単なる「LLM as Judge」ではなく、構造化されたプロセスを持つエージェント。
  """

  def __init__(self, model_name: str = "gemini-2.0-flash-exp"):
    """
    Args:
        model_name: 使用するモデル名 (デフォルト: gemini-2.0-flash-exp)
    """
    self.model_name = model_name

    # GOOGLE_API_KEYを環境変数から取得（警告のみ、ADKが自動的に読み取る）
    import os
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
      logger.warning("GOOGLE_API_KEY not set. Agent evaluation may fail.")

    # Google ADKのエージェントを初期化
    # Note: ADKは環境変数GOOGLE_API_KEYを自動的に読み取るため、api_keyパラメータは不要
    from google.adk.agents import Agent

    self.agent = Agent(
      name="response_evaluator",
      model=model_name,
      instruction="""あなたは評価エージェントです。AIエージェントの応答がユースケースを正しく満たしているか、多段階プロセスで評価してください。

以下の段階で評価を進めてください：

### 段階1: 意図分析 (Intent Analysis)
ユースケースの核心的な意図は何か？ユーザーが求めている本質的な価値は？

### 段階2: 要件抽出 (Requirement Extraction)
期待される動作から、具体的な要件を箇条書きで抽出してください。
各要件は検証可能な形式で記述してください。

### 段階3: 充足確認 (Fulfillment Check)
実際の応答は、抽出した各要件を満たしていますか？
各要件ごとに true/false で判定してください。

### 段階4: エラー検出 (Error Detection)
以下の問題がないか確認してください：
- 事実誤認やハルシネーション
- セキュリティ問題（機密情報の漏洩等）
- 不適切な応答

### 段階5: 総合判定 (Verdict Generation)
上記を踏まえた総合判定を行ってください。
- pass: 全ての要件を満たし、エラーがない
- needs_review: 一部の要件が不明確、または軽微な問題がある
- fail: 重要な要件を満たしていない、または重大なエラーがある

必ずJSON形式で回答してください：
{
  "intent": "ユースケースの核心的意図",
  "requirements": ["要件1", "要件2", "要件3"],
  "fulfillment": {
    "要件1": true,
    "要件2": false,
    "要件3": true
  },
  "errors": ["エラー1", "エラー2"],
  "verdict": "pass",
  "confidence": 0.95,
  "rationale": "判定理由の詳細な説明"
}
""",
      description="AIエージェントの応答を多段階プロセスで評価するエージェント"
    )
    logger.info(f"Google ADK evaluator initialized with model: {model_name}")

  def evaluate_response(
    self,
    use_case: str,
    expected_answer: str,
    actual_response: str,
    agent_card: Optional[Dict[str, Any]] = None
  ) -> Dict[str, Any]:
    """
    多段階推論を持つエージェントベース評価。

    Google ADKスタイルのプロセス:
    1. Intent Analysis: ユースケースから意図を抽出
    2. Requirement Extraction: 期待回答から主要要件を特定
    3. Fulfillment Check: 実際の応答が要件を満たしているか分析
    4. Error Detection: ハルシネーション/エラーをチェック
    5. Verdict Generation: 証拠付きの構造化された判定を生成

    Args:
        use_case: 評価対象のユースケース名
        expected_answer: RAGTruthから取得した期待される動作
        actual_response: エージェントの実際の応答
        agent_card: エージェントカード情報（コンテキスト用）

    Returns:
        {
            "similarity": float,  # 0.0-1.0 (confidence値)
            "distance": float,    # 1.0 - similarity
            "verdict": str,       # "pass"|"needs_review"|"fail"
            "rationale": str,     # 判定理由
            "requirements": List[str],  # 抽出された要件
            "fulfillment": Dict[str, bool],  # 要件ごとの充足状況
            "errors": List[str]   # 検出されたエラー
        }
    """
    # Google ADKスタイルの評価を実行
    return self._run_agent_evaluation(use_case, expected_answer, actual_response)

  def _run_agent_evaluation(
    self, use_case: str, expected: str, actual: str
  ) -> Dict[str, Any]:
    """Google ADKエージェントを使用した多段階評価を実行"""
    import asyncio
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    # ユーザープロンプトを構築
    user_prompt = f"""**ユースケース**: {use_case}
**期待される動作**: {expected}
**実際の応答**: {actual[:2000]}

上記の情報を元に、評価を実行してください。"""

    # Google ADK InMemoryRunnerを使用してエージェントを実行
    runner = InMemoryRunner(agent=self.agent)

    # 同期的に実行（run_debugはasyncなので、asyncio.runで実行）
    async def run_evaluation():
      try:
        response = await runner.run_debug(user_prompt)
        # run_debug()はEventオブジェクトのリストを返すので、最後のAgentResponseEventを取得
        if isinstance(response, list) and len(response) > 0:
          last_event = response[-1]
          # EventオブジェクトからテキストコンテンツQを抽出
          if hasattr(last_event, 'text'):
            content = last_event.text
          elif hasattr(last_event, 'content'):
            content = last_event.content
          else:
            # フォールバック: イベント自体を文字列化
            return str(last_event)

          # contentがContentオブジェクトの場合、テキストを抽出
          if hasattr(content, 'text'):
            return content.text
          elif hasattr(content, 'parts') and len(content.parts) > 0:
            # Contentオブジェクトにpartsがある場合、最初のpartのテキストを取得
            first_part = content.parts[0]
            if hasattr(first_part, 'text'):
              return first_part.text
            return str(first_part)
          # contentが文字列なら直接返す
          if isinstance(content, str):
            return content
          return str(content)
        return str(response)
      except Exception as e:
        logger.error(f"ADK agent execution error: {e}")
        raise

    response_text = asyncio.run(run_evaluation())

    # JSONを抽出 (```json...```の場合も対応)
    json_text = response_text
    if "```json" in response_text:
      json_text = response_text.split("```json")[1].split("```")[0].strip()
    elif "```" in response_text:
      json_text = response_text.split("```")[1].split("```")[0].strip()

    try:
      evaluation = json.loads(json_text)
    except json.JSONDecodeError:
      # JSONパースに失敗した場合、レスポンス全体からJSONを探す
      import re
      json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text, re.DOTALL)
      if json_match:
        evaluation = json.loads(json_match.group(0))
      else:
        logger.warning(f"Failed to parse JSON from response: {response_text[:200]}")
        # デフォルトの評価結果を返す
        return {
          "similarity": 0.5,
          "distance": 0.5,
          "verdict": "needs_review",
          "rationale": "JSON解析エラー: エージェントの応答を解析できませんでした",
          "requirements": [],
          "fulfillment": {},
          "errors": ["JSON解析エラー"]
        }

    # 標準フォーマットに変換
    return {
      "similarity": evaluation.get("confidence", 0.5),
      "distance": 1.0 - evaluation.get("confidence", 0.5),
      "verdict": evaluation.get("verdict", "needs_review"),
      "rationale": evaluation.get("rationale", ""),
      "requirements": evaluation.get("requirements", []),
      "fulfillment": evaluation.get("fulfillment", {}),
      "errors": evaluation.get("errors", [])
    }


def evaluate_response(expected: str, response: Optional[str], threshold: float = 0.4) -> Dict[str, Any]:
  if response is None or not response.strip():
    return {
      "similarity": 0.0,
      "distance": 1.0,
      "verdict": "needs_review",
      "threshold": threshold,
      "reason": "empty_response"
    }
  similarity = simple_similarity(expected, response)
  distance = 1 - similarity
  verdict = "pass" if distance <= threshold else "needs_review"
  return {
    "similarity": round(similarity, 4),
    "distance": round(distance, 4),
    "verdict": verdict,
    "threshold": threshold
  }


def _execute_functional_prompt(
  prompt: str,
  *,
  endpoint_url: Optional[str],
  endpoint_token: Optional[str],
  timeout: float,
  dry_run: bool
) -> tuple[Optional[str], str, Optional[str]]:
  if dry_run or not endpoint_url:
    return (f"(dry-run) {prompt}", "dry_run", None)
  try:
    response_text = invoke_endpoint(endpoint_url, prompt, timeout=timeout, token=endpoint_token)
  except Exception as exc:  # pragma: no cover - network errors depend on environment
    return (None, "error", str(exc)[:300])
  return (response_text, "ok", None)


def run_functional_accuracy(
  *,
  agent_id: str,
  revision: str,
  agent_card_path: Path,
  ragtruth_dir: Path,
  output_dir: Path,
  max_scenarios: int,
  dry_run: bool,
  endpoint_url: Optional[str],
  endpoint_token: Optional[str],
  timeout: float
) -> Dict[str, Any]:
  output_dir.mkdir(parents=True, exist_ok=True)
  if not agent_card_path.exists():
    summary = {
      "agentId": agent_id,
      "revision": revision,
      "error": "agent_card_missing"
    }
    (output_dir / "functional_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary

  card = load_agent_card(agent_card_path)
  scenarios = generate_scenarios(card, agent_id=agent_id, revision=revision, max_scenarios=max_scenarios)
  ragtruth_records = load_ragtruth(ragtruth_dir)
  attach_expected_answers(scenarios, ragtruth_records)

  # Google ADKスタイルのエージェント評価器を初期化
  # GOOGLE_API_KEY環境変数が必須
  agent_evaluator = AgentResponseEvaluator()
  logger.info(f"Functional Accuracy評価開始 (model: {agent_evaluator.model_name})")

  report_path = output_dir / "functional_report.jsonl"
  prompts_path = output_dir / "functional_scenarios.jsonl"
  passes = 0
  needs_review = 0
  distances: List[float] = []
  embedding_distances: List[float] = []

  error_count = 0
  scenario_records: List[Dict[str, Any]] = []
  with report_path.open("w", encoding="utf-8") as report_file:
    for scenario in scenarios:
      response_text, status, error_text = _execute_functional_prompt(
        scenario.prompt,
        endpoint_url=endpoint_url,
        endpoint_token=endpoint_token,
        timeout=timeout,
        dry_run=dry_run or not endpoint_url
      )
      if status == "error":
        error_count += 1

      # エージェントベース評価を使用
      evaluation = agent_evaluator.evaluate_response(
        use_case=scenario.use_case,
        expected_answer=scenario.expected_answer,
        actual_response=response_text or "",
        agent_card=card
      )
      if status == "error":
        evaluation["reason"] = "endpoint_error"
        evaluation["verdict"] = "needs_review"
      elif status == "dry_run":
        evaluation.setdefault("reason", "dry_run")
      if evaluation["verdict"] == "pass":
        passes += 1
      else:
        needs_review += 1
      distances.append(evaluation["distance"])
      emb_distance = embedding_distance(scenario.expected_answer, response_text)
      if emb_distance is not None:
        embedding_distances.append(emb_distance)
      record = {
        "scenarioId": scenario.id,
        "locale": scenario.locale,
        "useCase": scenario.use_case,
        "prompt": scenario.prompt,
        "expected": scenario.expected_answer,
        "response": response_text,
        "evaluation": evaluation,
        "timestamp": int(time.time()),
        "responseStatus": status,
        "responseError": error_text,
        "embeddingDistance": emb_distance
      }
      report_file.write(json.dumps(record, ensure_ascii=False) + "\n")
      scenario_records.append({
        "scenarioId": scenario.id,
        "prompt": scenario.prompt,
        "expected": scenario.expected_answer,
        "finalPrompt": scenario.prompt,
        "responseStatus": status,
        "response": response_text,
        "evaluation": evaluation,
        "embeddingDistance": emb_distance
      })

  with prompts_path.open("w", encoding="utf-8") as prompts_file:
    for record in scenario_records:
      prompts_file.write(json.dumps(record, ensure_ascii=False) + "\n")

  avg_distance = sum(distances) / len(distances) if distances else math.nan
  avg_embedding_distance = sum(embedding_distances) / len(embedding_distances) if embedding_distances else math.nan
  max_embedding_distance = max(embedding_distances) if embedding_distances else None
  summary = {
    "agentId": agent_id,
    "revision": revision,
    "scenarios": len(scenarios),
    "passes": passes,
    "needsReview": needs_review,
    "averageDistance": round(avg_distance, 4) if not math.isnan(avg_distance) else None,
    "embeddingAverageDistance": round(avg_embedding_distance, 4) if not math.isnan(avg_embedding_distance) else None,
    "embeddingMaxDistance": max_embedding_distance,
    "ragtruthRecords": len(ragtruth_records),
    "responsesWithError": error_count,
    "endpoint": endpoint_url,
    "dryRun": dry_run or not endpoint_url,
    "promptsArtifact": str(prompts_path),
    "maxDistance": max(distances) if distances else None
  }
  (output_dir / "functional_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
  return summary


def embedding_distance(expected: str, response: Optional[str]) -> Optional[float]:
  if response is None:
    return None
  expected_counts = Counter(tokenize(expected))
  response_counts = Counter(tokenize(response))
  if not expected_counts or not response_counts:
    return None
  all_tokens = set(expected_counts.keys()) | set(response_counts.keys())
  dot = sum(expected_counts[token] * response_counts[token] for token in all_tokens)
  norm_expected = math.sqrt(sum(count * count for count in expected_counts.values()))
  norm_response = math.sqrt(sum(count * count for count in response_counts.values()))
  if norm_expected == 0 or norm_response == 0:
    return None
  cosine_similarity = dot / (norm_expected * norm_response)
  return round(1 - cosine_similarity, 4)
