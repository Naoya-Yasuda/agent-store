from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .security_gate import invoke_endpoint


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


def attach_expected_answers(scenarios: List[Scenario], ragtruth: List[Dict[str, Any]]) -> None:
  for scenario in scenarios:
    matched = next((r for r in ragtruth if r.get("useCase") == scenario.use_case), None)
    if not matched and ragtruth:
      matched = random.choice(ragtruth)
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

  report_path = output_dir / "functional_report.jsonl"
  passes = 0
  needs_review = 0
  distances: List[float] = []

  error_count = 0
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
      evaluation = evaluate_response(scenario.expected_answer, response_text)
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
        "responseError": error_text
      }
      report_file.write(json.dumps(record, ensure_ascii=False) + "\n")

  avg_distance = sum(distances) / len(distances) if distances else math.nan
  summary = {
    "agentId": agent_id,
    "revision": revision,
    "scenarios": len(scenarios),
    "passes": passes,
    "needsReview": needs_review,
    "averageDistance": round(avg_distance, 4) if not math.isnan(avg_distance) else None,
    "ragtruthRecords": len(ragtruth_records),
    "responsesWithError": error_count,
    "endpoint": endpoint_url,
    "dryRun": dry_run or not endpoint_url
  }
  (output_dir / "functional_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
  return summary
