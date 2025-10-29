#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[3]
PROJECT_SCENARIO = ROOT / "prototype/inspect-worker/scenarios/generic_eval.yaml"
OUTPUT_DIR = ROOT / "prototype/inspect-worker/out"
AISEV_ROOT = Path(os.environ.get("AISEV_HOME", ROOT / "third_party/aisev"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Inspect evaluation using aisev scenario")
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--scenario", default=os.environ.get("INSPECT_SCENARIO", str(PROJECT_SCENARIO)))
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR"), help="Path to sandbox artifacts directory")
    parser.add_argument("--manifest", default=os.environ.get("MANIFEST_PATH", str(ROOT / "prompts/aisi/manifest.tier3.json")))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = OUTPUT_DIR / args.agent_id / args.revision
    output_path.mkdir(parents=True, exist_ok=True)

    artifacts_dir = Path(args.artifacts)
    response_samples_file = artifacts_dir / "response_samples.jsonl"
    policy_score_file = artifacts_dir / "policy_score.json"

    if not response_samples_file.exists():
        raise FileNotFoundError("response_samples.jsonl が見つかりません。Sandbox Runnerを実行してください。")

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest が見つかりません: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    question_map = _load_questions(manifest_path.parent, manifest.get("questionFiles", []))

    records = _load_response_records(response_samples_file, question_map)
    dataset_path = output_path / "inspect_dataset.jsonl"
    _write_inspect_dataset(dataset_path, records)

    use_placeholder = os.environ.get("INSPECT_USE_PLACEHOLDER", "false").lower() == "true"
    inspect_info: Dict[str, Any] | None = None
    if use_placeholder:
        latencies, eval_results, compliance_ratio, inspect_info = _placeholder_eval(records)
    else:
        latencies, eval_results, compliance_ratio, inspect_info = _run_inspect_eval(records, output_path)

    policy_score = 0.0
    if policy_score_file.exists():
        policy_score_data = json.loads(policy_score_file.read_text(encoding="utf-8"))
        policy_score = policy_score_data.get("score", 0.0)

    passed = sum(1 for entry in eval_results if entry.get("compliant"))
    total = len(eval_results)
    summary = {
        "agentId": args.agent_id,
        "revision": args.revision,
        "outputDir": str(output_path),
        "score": compliance_ratio,
        "policyScore": policy_score,
        "avgLatencyMs": sum(latencies) / len(latencies) if latencies else None,
        "passed": passed,
        "total": total,
        "notes": "Inspect評価 (inspect_aiが有効な場合はCLI実行、それ以外はプレースホルダー)"
    }

    if inspect_info:
        summary["inspect"] = inspect_info

    details_path = output_path / "details.json"
    details_path.write_text(json.dumps(eval_results, indent=2, ensure_ascii=False), encoding="utf-8")

    (output_path / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")


def _load_questions(base_dir: Path, files: List[str]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for rel_path in files:
        question_path = base_dir / rel_path
        if not question_path.exists():
            continue
        data = json.loads(question_path.read_text(encoding="utf-8"))
        question_id = data.get("id")
        if question_id:
            result[question_id] = data
    return result


def _load_response_records(response_samples_file: Path, question_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    if not response_samples_file.exists():
        return records

    with response_samples_file.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            sample = json.loads(line)
            question_id = sample.get("questionId")
            question = question_map.get(question_id, {})
            tolerance = question.get("tolerance") or {}
            record = {
                "questionId": question_id,
                "prompt": question.get("prompt") or sample.get("inputText") or "",
                "inputText": sample.get("inputText") or "",
                "expectedBehaviour": question.get("expectedBehaviour") or "",
                "outputText": sample.get("outputText") or "",
                "latencyMs": sample.get("latencyMs", 0),
                "tokensOut": sample.get("tokensOut"),
                "tolerance": tolerance,
                "notes": question.get("notes"),
            }
            records.append(record)
    return records


def _placeholder_eval(records: List[Dict[str, Any]]) -> Tuple[List[float], List[Dict[str, Any]], float, Dict[str, Any] | None]:
    latencies: List[float] = []
    eval_results: List[Dict[str, Any]] = []
    passed = 0
    total = 0

    for record in records:
        question_id = record.get("questionId")
        output_text = record.get("outputText", "")
        tolerance = record.get("tolerance") or {}
        allowed = tolerance.get("allowedPhrases") or []
        blocked = tolerance.get("blockedPhrases") or []

        lower_output = output_text.lower()
        is_allowed = all(word.lower() not in lower_output for word in blocked)
        contains_required = True
        if allowed:
            contains_required = any(word.lower() in lower_output for word in allowed)

        compliant = bool(is_allowed and contains_required)
        if compliant:
            passed += 1
        total += 1

        latencies.append(record.get("latencyMs", 0))
        eval_results.append({
            "questionId": question_id,
            "output": output_text,
            "allowedPhrases": allowed,
            "blockedPhrases": blocked,
            "compliant": compliant,
            "notes": record.get("expectedBehaviour")
        })

    compliance_ratio = passed / total if total else 0.0
    return latencies, eval_results, compliance_ratio, None


def _run_inspect_eval(
    records: List[Dict[str, Any]],
    output_path: Path
) -> Tuple[List[float], List[Dict[str, Any]], float, Dict[str, Any] | None]:
    try:
        from inspect_ai.dataset import Sample
        from inspect_ai.model import ModelOutput
        from inspect_ai.scorer import model_graded_qa
        from inspect_ai.solver import Generate, TaskState, solver
        from inspect_ai._eval.eval import eval as inspect_eval
        from inspect_ai._eval.task import Task
    except ImportError as error:
        print(f"[inspect-worker] inspect_ai import failed: {error}. Falling back to placeholder evaluation.")
        return _placeholder_eval(records)

    if not records:
        return [], [], 0.0, None

    log_dir = output_path / "inspect_logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    judge_model = os.environ.get("INSPECT_GRADER_MODEL", "mockllm/model")

    @solver
    def replay_solver():
        async def solve(state: TaskState, generate: Generate):
            output_text = state.metadata.get("outputText", "")
            state.output = ModelOutput.from_content(
                model=os.environ.get("INSPECT_REPLAY_MODEL", "replay"),
                content=output_text
            )
            state.completed = True
            return state
        return solve

    samples: List[Sample] = []
    for record in records:
        metadata = {
            "questionId": record.get("questionId"),
            "expectedBehaviour": record.get("expectedBehaviour"),
            "tolerance": record.get("tolerance"),
            "latencyMs": record.get("latencyMs"),
            "tokensOut": record.get("tokensOut"),
            "notes": record.get("notes"),
            "outputText": record.get("outputText"),
        }
        sample = Sample(
            input=record.get("prompt") or record.get("inputText") or "",
            target=record.get("expectedBehaviour") or "",
            id=record.get("questionId"),
            metadata=metadata
        )
        samples.append(sample)

    task = Task(
        dataset=samples,
        solver=replay_solver(),
        scorer=model_graded_qa(model=judge_model)
    )

    try:
        logs = inspect_eval(
            tasks=[task],
            log_dir=str(log_dir),
            log_format="json",
            model=None,
            display="none",
            score_display=False,
        )
    except Exception as error:
        print(f"[inspect-worker] inspect eval execution failed: {error}. Falling back to placeholder evaluation.")
        return _placeholder_eval(records)

    if not logs:
        print("[inspect-worker] inspect eval returned no logs. Falling back to placeholder evaluation.")
        return _placeholder_eval(records)

    log = logs[0]
    scorer_name = log.results.scores[0].name if log.results.scores else "model_graded_qa"

    latencies: List[float] = []
    eval_results: List[Dict[str, Any]] = []
    passed = 0

    for sample in log.samples:
        metadata = sample.metadata or {}
        question_id = metadata.get("questionId") or sample.id
        score = (sample.scores or {}).get(scorer_name)
        grade = getattr(score, "value", None)
        compliant = grade == "C"
        if compliant:
            passed += 1
        latencies.append(metadata.get("latencyMs", 0))

        eval_results.append({
            "questionId": question_id,
            "output": sample.output.completion if sample.output else "",
            "expectedBehaviour": metadata.get("expectedBehaviour"),
            "allowedPhrases": (metadata.get("tolerance") or {}).get("allowedPhrases"),
            "blockedPhrases": (metadata.get("tolerance") or {}).get("blockedPhrases"),
            "grade": grade,
            "judgeModel": judge_model,
            "explanation": getattr(score, "explanation", None),
            "compliant": compliant,
            "latencyMs": metadata.get("latencyMs"),
            "notes": metadata.get("notes")
        })

    compliance_ratio = passed / len(log.samples) if log.samples else 0.0

    aggregated_metrics = {}
    for eval_score in log.results.scores or []:
        aggregated_metrics[eval_score.name] = {
            metric_name: metric.value for metric_name, metric in (eval_score.metrics or {}).items()
        }

    inspect_info: Dict[str, Any] | None = None
    if log.location:
        inspect_info = {
            "logFile": str(log.location),
            "judgeModel": judge_model,
            "metrics": aggregated_metrics
        }
        log_info = {
            "logFile": str(log.location),
            "judgeModel": judge_model,
            "metrics": aggregated_metrics
        }
        (output_path / "inspect_log_index.json").write_text(
            json.dumps(log_info, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )

    return latencies, eval_results, compliance_ratio, inspect_info


def _write_inspect_dataset(dataset_path: Path, records: List[Dict[str, Any]]) -> None:
    dataset_path.parent.mkdir(parents=True, exist_ok=True)
    with dataset_path.open("w", encoding="utf-8") as out_file:
        for record in records:
            serialized = {
                "id": record.get("questionId"),
                "input": record.get("prompt"),
                "expected": record.get("expectedBehaviour"),
                "output": record.get("outputText"),
                "latencyMs": record.get("latencyMs"),
                "tokensOut": record.get("tokensOut"),
                "tolerance": record.get("tolerance"),
                "notes": record.get("notes"),
            }
            out_file.write(json.dumps(serialized, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
