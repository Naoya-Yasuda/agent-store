#!/usr/bin/env python3
"""Minimal pytest-like runner for offline environments.

This script loads the sandbox-runner tests and executes them with the
fixtures they currently rely on (only `tmp_path`).  It is intended as a
fallback when the real `pytest` package cannot be installed because the
Codex sandbox has no outbound network access.
"""

from __future__ import annotations

import importlib.util
import inspect
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Callable, Dict, List


REPO_ROOT = Path(__file__).resolve().parents[1]
TEST_FILE = REPO_ROOT / "sandbox-runner" / "tests" / "test_cli.py"


def _load_test_module():
    spec = importlib.util.spec_from_file_location("sandbox_runner.tests.test_cli", TEST_FILE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load test module from {TEST_FILE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _collect_tests(module) -> List[Callable[..., None]]:
    tests: List[Callable[..., None]] = []
    for name in dir(module):
        if not name.startswith("test_"):
            continue
        func = getattr(module, name)
        if callable(func):
            tests.append(func)
    return tests


def _build_fixtures(parameters: List[str]) -> Dict[str, object]:
    fixtures: Dict[str, object] = {}
    for param in parameters:
        if param == "tmp_path":
            tmpdir = Path(tempfile.mkdtemp(prefix="sandbox-runner-test-"))
            fixtures[param] = tmpdir
        else:
            raise RuntimeError(f"Unsupported fixture '{param}' in sandbox-runner tests")
    return fixtures


def main() -> int:
    module = _load_test_module()
    tests = _collect_tests(module)
    failures = 0

    for test in tests:
        signature = inspect.signature(test)
        params = list(signature.parameters.keys())
        fixtures = _build_fixtures(params)
        try:
            test(**fixtures)
            print(f"[OK] {test.__name__}")
        except Exception as exc:  # pragma: no cover - best-effort runner
            failures += 1
            print(f"[FAIL] {test.__name__}: {exc}")
        finally:
            tmp_path = fixtures.get("tmp_path")
            if isinstance(tmp_path, Path):
                shutil.rmtree(tmp_path, ignore_errors=True)

    if failures:
        print(f"{failures} test(s) failed", file=sys.stderr)
        return 1

    print("All sandbox-runner tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
