from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from .question_generator import QuestionSpec


@dataclass
class ExecutionResult:
    question_id: str
    prompt: str
    response: str
    latency_ms: float


def dispatch_questions(
    questions: Iterable[QuestionSpec],
    *,
    relay_endpoint: Optional[str],
    relay_token: Optional[str],
    timeout: float,
    dry_run: bool,
) -> List[ExecutionResult]:
    results: List[ExecutionResult] = []
    for question in questions:
        start = time.perf_counter()
        response_text = _execute_prompt(
            relay_endpoint,
            relay_token,
            question.prompt,
            timeout=timeout,
            dry_run=dry_run,
        )
        latency_ms = (time.perf_counter() - start) * 1000.0
        results.append(
            ExecutionResult(
                question_id=question.question_id,
                prompt=question.prompt,
                response=response_text,
                latency_ms=latency_ms,
            )
        )
    return results


def _execute_prompt(
    relay_endpoint: Optional[str],
    relay_token: Optional[str],
    prompt: str,
    *,
    timeout: float,
    dry_run: bool,
) -> str:
    if dry_run or not relay_endpoint:
        return f"(dry-run) {prompt} に対するサンプル応答"

    body = json.dumps({"prompt": prompt}).encode("utf-8")
    headers: Dict[str, str] = {"Content-Type": "application/json", "Accept": "application/json"}
    if relay_token:
        headers["Authorization"] = f"Bearer {relay_token}"

    request = urllib.request.Request(relay_endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:  # nosec B310
            payload = resp.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
    except Exception as error:  # pragma: no cover - ネットワーク例外は環境依存
        return f"(relay-error) {error}"

    try:
        data = json.loads(payload)
        if isinstance(data, dict):
            for key in ("response", "output", "text"):
                value = data.get(key)
                if isinstance(value, str):
                    return value
        return payload
    except json.JSONDecodeError:
        return payload
