# Repository Guidelines
回答は日本語ですること。回答内の専門用語は解説をつけること

## Project Structure & Module Organization
- `api/` houses the Express routers, repositories, and services behind the catalog; reuse interfaces from `prototype/temporal-review-workflow/src/types` and keep payloads in sync with `schemas/*.json`.
- `sandbox-runner/` is the Python 3.11 CLI with schemas/tests that generate policy, fairness, and metadata artifacts for review.
- `prototype/inspect-worker/` replays sandbox outputs through AISI Inspect, and `prompts/aisi/` stores the manifests/questions referenced by both runner and worker.
- `scripts/` carries operational helpers (`setup_aisev.sh`, `run_inspect_flow.sh`, migrations), `docs/` records design decisions, and `third_party/aisev/` is a cloned dependency kept read-only.

## Build, Test, and Development Commands
```bash
python3.13 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cd sandbox-runner && pip install -e .[dev] && pytest
python -m sandbox_runner.cli --agent-id demo --revision rev1 --template google-adk --dry-run --generate-fairness
scripts/run_inspect_flow.sh
cd prototype/temporal-review-workflow && npm install && npm run build && npm run lint
```

## Coding Style & Naming Conventions
- TypeScript: enforce 2-space indent, `camelCase` functions/fields, `PascalCase` types, named exports, and JSON-schema validation at route boundaries; update schemas and types together.
- Python: keep modules typed, isolate IO inside `sandbox_runner.cli`, guard optional deps such as `wandb`, and emit UTF-8 JSON with `ensure_ascii=False`; CLI flags stay kebab-case.
- JSON/YAML manifests stay sorted and human-readable, while generated artifacts in `sandbox-runner/artifacts/` or `prototype/inspect-worker/out/` remain untouched.

## Testing Guidelines
- ルート `pytest.ini` で `third_party/` や `docs/` など外部ソースを `norecursedirs` に指定し、デフォルトではリポジトリ本体のユニットテストのみ走るようにしています。外部依存を確認したい場合は `pytest third_party/...` のように個別指定してください。
- `pytest` (configured in `sandbox-runner/pyproject.toml`) is required for runner changes; mirror the positive/negative cases in `sandbox-runner/tests/test_cli.py` before merging.
- TypeScript validators extend `tests/agentCard.test.ts`; add acceptance and rejection cases when schemas or services change, and run them with any Jest-compatible runner such as `npx vitest tests/agentCard.test.ts`.
- Inspect enhancements should include replay fixtures plus the resulting `summary.json` from `prototype/inspect-worker/out/<agent>/<revision>/` for reviewer context.

## Commit & Pull Request Guidelines
- Follow the current history: concise subject (JP or EN) plus a body describing rationale and key files.
- Every PR must link an issue, list verification commands (`pytest`, `scripts/run_inspect_flow.sh`, `npm run build`, etc.), and attach screenshots or logs for reviewer-facing flows.
- Keep commits scoped; pair schema or dependency updates with their tests, and isolate Docker/tooling bumps for easy rollback.

## Security & Configuration Tips
- Copy `.env.example` (root) and `prototype/inspect-worker/.env.inspect.example`; never commit populated secrets.
- Run `scripts/setup_aisev.sh` to populate `third_party/aisev/` before using Inspect tooling, and treat that checkout as read-only.
- Use `INSPECT_SKIP_DOCKER_BUILD=1 scripts/run_inspect_flow.sh` for local dry-runs, but ensure a full Docker build passes before review.
