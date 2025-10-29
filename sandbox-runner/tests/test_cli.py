from pathlib import Path

from sandbox_runner.cli import main


def test_cli_generates_artifacts(tmp_path: Path) -> None:
    artifacts_dir = tmp_path / "artifacts"
    exit_code = main([
        "--agent-id", "demo",
        "--revision", "rev1",
        "--template", "google-adk",
        "--output-dir", str(artifacts_dir),
        "--dry-run"
    ])

    assert exit_code == 0
    assert (artifacts_dir / "response_samples.jsonl").exists()
    assert (artifacts_dir / "policy_score.json").exists()
    metadata_text = (artifacts_dir / "metadata.json").read_text(encoding="utf-8")
    assert "demo" in metadata_text
