import argparse
import json
import os
import random
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

from jsonschema import Draft202012Validator, ValidationError

WANDB_DISABLED = os.environ.get("WANDB_DISABLED", "true").lower() == "true"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sandbox runner minimal CLI")
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--template", required=True, choices=["google-adk", "langgraph"])
    parser.add_argument("--output-dir", default="artifacts")
    parser.add_argument("--dry-run", action="store_true", help="Skip external calls, generate placeholder artifacts")
    parser.add_argument("--wandb-project", default="agent-store-sandbox")
    parser.add_argument("--wandb-entity", default="local")
    parser.add_argument("--wandb-base-url", default="https://wandb.fake")
    parser.add_argument("--schema-dir", default=str(Path(__file__).resolve().parent.parent / "schemas"), help="Directory containing JSON schemas")
    return parser.parse_args(argv)


def simulate_wandb_run(agent_id: str, revision: str, template: str, *, project: str, entity: str, base_url: str) -> Dict[str, Any]:
    run_id = f"sandbox-{agent_id}-{revision}-{uuid.uuid4().hex[:8]}"
    if WANDB_DISABLED:
        return {
            "enabled": False,
            "runId": run_id,
            "url": None,
            "notes": "WANDB_DISABLED=true"
        }
    # Placeholder: actual implementation would call wandb sdk
    return {
        "enabled": True,
        "runId": run_id,
        "url": f"{base_url.rstrip('/')}/{entity}/{project}/runs/{run_id}",
        "notes": "simulated run"
    }


def load_schema(schema_dir: Path, filename: str) -> Dict[str, Any]:
    schema_path = schema_dir / filename
    with schema_path.open(encoding="utf-8") as f:
        return json.load(f)


def validate_artifacts(samples: List[Dict[str, Any]], policy_score: Dict[str, Any], schema_dir: Path) -> None:
    response_schema = load_schema(schema_dir, "response_sample.schema.json")
    policy_schema = load_schema(schema_dir, "policy_score.schema.json")
    sample_validator = Draft202012Validator(response_schema)
    policy_validator = Draft202012Validator(policy_schema)
    for sample in samples:
        sample_validator.validate(sample)
    policy_validator.validate(policy_score)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    random.seed(args.agent_id + args.revision)

    response_samples: list[Dict[str, Any]] = []
    for question_id in ("safety.general", "privacy.data_retention"):
        latency_ms = random.randint(900, 1800)
        tokens_out = random.randint(80, 180)
        output_text = "申し訳ありませんが対応できません。" if question_id == "safety.general" else "データは24時間で削除します。"
        response_samples.append(
            {
                "questionId": question_id,
                "inputText": f"{question_id} に対する応答",
                "outputText": output_text,
                "latencyMs": latency_ms,
                "tokensOut": tokens_out,
            }
        )

    policy_score: Dict[str, Any] = {
        "score": round(random.uniform(0.9, 0.99), 3),
        "rulesViolated": [],
        "evaluatorVersion": "placeholder-1"
    }

    schema_dir = Path(args.schema_dir)

    try:
        validate_artifacts(response_samples, policy_score, schema_dir)
    except ValidationError as exc:
        print(f"[sandbox-runner] validation error: {exc.message}", file=sys.stderr)
        return 2

    wandb_info = simulate_wandb_run(
        args.agent_id,
        args.revision,
        args.template,
        project=args.wandb_project,
        entity=args.wandb_entity,
        base_url=args.wandb_base_url
    )

    (output_dir / "response_samples.jsonl").write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in response_samples)
    )
    (output_dir / "policy_score.json").write_text(json.dumps(policy_score, ensure_ascii=False, indent=2))

    metadata = {
        "agentId": args.agent_id,
        "revision": args.revision,
        "template": args.template,
        "dryRun": args.dry_run,
        "timestamp": int(time.time()),
        "wandb": {
            **wandb_info,
            "project": args.wandb_project,
            "entity": args.wandb_entity,
            "baseUrl": args.wandb_base_url
        },
    }
    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))

    print(f"[sandbox-runner] generated artifacts in {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
