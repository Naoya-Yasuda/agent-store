#!/usr/bin/env python3
"""Validate AISI prompt manifests and questions against JSON Schemas."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Set, Tuple

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
PROMPTS_DIR = ROOT / "prompts/aisi"
SCHEMA_DIR = PROMPTS_DIR / "schema"

MANIFEST_SCHEMA_PATH = SCHEMA_DIR / "manifest.schema.json"
QUESTION_SCHEMA_PATH = SCHEMA_DIR / "question.schema.json"


def load_json(path: Path) -> Dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def enforce_category_requirements(manifest_path: Path, categories: Set[str]) -> None:
    with manifest_path.open(encoding="utf-8") as f:
        manifest = json.load(f)
    risk_tier = manifest.get("riskTier")
    required_by_tier = {
        "tier1": {"safety"},
        "tier2": {"safety", "privacy"},
        "tier3": {"safety", "privacy", "misinformation"}
    }
    localization_required = {
        "tier3"
    }
    required = required_by_tier.get(risk_tier, set())
    missing = required - categories
    if missing:
        raise ValueError(
            f"Manifest {manifest_path.name} (tier={risk_tier}) missing required categories: {sorted(missing)}"
        )

    if risk_tier in localization_required:
        if not any(q_file.endswith('privacy.localization.json') for q_file in manifest.get('questionFiles', [])):
            raise ValueError(
                f"Manifest {manifest_path.name} requires privacy.localization question for tier3 localization checks"
            )


def validate_manifest(manifest_path: Path) -> Tuple[Set[str], Set[str]]:
    manifest_schema = load_json(MANIFEST_SCHEMA_PATH)
    validator = Draft202012Validator(manifest_schema)
    manifest = load_json(manifest_path)
    validator.validate(manifest)
    base_dir = manifest_path.parent
    question_ids: Set[str] = set()
    categories: Set[str] = set()
    for rel_path in manifest.get("questionFiles", []):
        question_path = base_dir / rel_path
        if not question_path.exists():
            raise FileNotFoundError(f"Question file not found: {question_path}")
        question = load_json(question_path)
        question_schema = load_json(QUESTION_SCHEMA_PATH)
        Draft202012Validator(question_schema).validate(question)
        qid = question.get("id")
        if qid in question_ids:
            raise ValueError(f"Duplicate question id '{qid}' in manifest {manifest_path}")
        question_ids.add(qid)
        category = question.get("category")
        if isinstance(category, str):
            categories.add(category)
    return question_ids, categories


def main() -> None:
    manifests = sorted(PROMPTS_DIR.glob("manifest*.json"))
    if not manifests:
        raise SystemExit("No manifest files found under prompts/aisi")

    all_ids: Set[str] = set()
    for manifest_path in manifests:
        ids, categories = validate_manifest(manifest_path)
        overlap = all_ids.intersection(ids)
        if overlap:
            print(f"Note: shared question ids across manifests: {sorted(overlap)}")
        all_ids.update(ids)
        enforce_category_requirements(manifest_path, categories)
        print(f"Validated {manifest_path} ({len(ids)} question ids)")

    print("All manifests and questions validated successfully.")


if __name__ == "__main__":
    main()
