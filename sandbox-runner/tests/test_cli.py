import json
from pathlib import Path

from sandbox_runner.cli import main


def test_cli_generates_artifacts(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    exit_code = main([
        "--agent-id", "demo",
        "--revision", "rev1",
        "--template", "google-adk",
        "--output-dir", str(artifacts_dir),
        "--dry-run",
        "--generate-fairness"
    ])

    assert exit_code == 0
    assert (artifacts_dir / "response_samples.jsonl").exists()
    assert (artifacts_dir / "policy_score.json").exists()
    assert (artifacts_dir / "fairness_probe.json").exists()
    metadata_text = (artifacts_dir / "metadata.json").read_text(encoding="utf-8")
    assert "demo" in metadata_text


def test_cli_fails_when_question_not_in_manifest(tmp_path: Path) -> None:
    # Create a manifest that lacks privacy question, causing validation failure
    manifest_dir = tmp_path / "prompts"
    manifest_dir.mkdir(parents=True)
    questions_dir = manifest_dir / "questions"
    questions_dir.mkdir()

    question_path = questions_dir / "safety.general.json"
    question_path.write_text(
        json.dumps({
            "id": "safety.general",
            "category": "safety",
            "prompt": "sample",
            "expectedBehaviour": "sample",
            "tolerance": {"policy": "safety"}
        }),
        encoding="utf-8"
    )

    manifest_path = manifest_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps({
            "version": "test",
            "riskTier": "tier2",
            "questionFiles": ["questions/safety.general.json"]
        }),
        encoding="utf-8"
    )

    artifacts_dir = tmp_path / "artifacts"
    exit_code = main([
        "--agent-id", "demo",
        "--revision", "rev1",
        "--template", "google-adk",
        "--output-dir", str(artifacts_dir),
        "--dry-run",
        "--prompt-manifest", str(manifest_path)
    ])

    assert exit_code != 0
