#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[2]
PROJECT_SCENARIO = ROOT / "prototype/inspect-worker/scenarios/generic_eval.yaml"
OUTPUT_DIR = ROOT / "prototype/inspect-worker/out"
AISEV_ROOT = ROOT / "third_party/aisev"


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

    env = os.environ.copy()
    env["INSPECT_MANIFEST_PATH"] = args.manifest
    env["INSPECT_RESPONSE_SAMPLES"] = str(Path(args.artifacts) / "response_samples.jsonl")

    command = [
        str(AISEV_ROOT / "bin/inspect"),
        "run",
        "--config",
        args.scenario,
        "--output",
        str(output_path)
    ]

    subprocess.run(command, check=True, cwd=AISEV_ROOT, env=env)

    summary = {
        "agentId": args.agent_id,
        "revision": args.revision,
        "outputDir": str(output_path)
    }
    (output_path / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
