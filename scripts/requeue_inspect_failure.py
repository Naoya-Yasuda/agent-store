#!/usr/bin/env python3
"""Inspect失敗ジョブを再キューするための簡易スクリプト(POC)。"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import List

FAILED_DIR = Path("prototype/inspect-worker/out_failed")
QUEUE_FILE = Path("prototype/inspect-worker/retry_queue.jsonl")


def load_failed_jobs() -> List[dict]:
    jobs = []
    if not FAILED_DIR.exists():
        return jobs
    for path in FAILED_DIR.glob("*.json"):
        with path.open(encoding="utf-8") as f:
            jobs.append(json.load(f))
    return jobs


def enqueue_jobs(jobs: List[dict]) -> None:
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with QUEUE_FILE.open("a", encoding="utf-8") as f:
        for job in jobs:
            f.write(json.dumps(job) + "\n")
    print(f"Enqueued {len(jobs)} jobs to {QUEUE_FILE}")


def main() -> None:
    jobs = load_failed_jobs()
    if not jobs:
        print("No failed jobs found")
        return
    enqueue_jobs(jobs)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - simple script
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
