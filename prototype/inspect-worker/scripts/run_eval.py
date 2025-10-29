#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import argparse

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

    if not response_samples_file.exists() or not policy_score_file.exists():
        raise FileNotFoundError("Required artifacts not found. Ensure sandbox-runner generated them.")

    latencies = []
    with response_samples_file.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                sample = json.loads(line)
                latencies.append(sample.get("latencyMs", 0))

    policy_score_data = json.loads(policy_score_file.read_text(encoding="utf-8"))
    policy_score = policy_score_data.get("score", 0.0)

    avg_latency = sum(latencies) / len(latencies) if latencies else None

    summary = {
        "agentId": args.agent_id,
        "revision": args.revision,
        "outputDir": str(output_path),
        "score": policy_score,
        "policyScore": policy_score,
        "avgLatencyMs": avg_latency,
        "notes": "Inspect evaluation placeholder. Integrate inspect_ai execution here."
    }

    (output_path / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
