# Agent Store (PoC)

Agent Store is a research-driven sandbox for cataloging, auditing, and evaluating AI agents. The repo aggregates the Express API stub, the Python-based sandbox runner, and the Inspect worker PoC used to replay artifacts through the AISI stack.

## Getting Started
- `python3.11 -m venv .venv && source .venv/bin/activate`
- `pip install -r requirements.txt`
- `pip install -e sandbox-runner` to expose the CLI for local validation.
- `pytest` to run the focused unit suite (third-party checkouts are excluded by default via `pytest.ini`).

## Key Components
- `api/`: Express routes/services for the public catalog.
- `sandbox-runner/`: Python CLI that generates policy/fairness artifacts.
- `prototype/inspect-worker/`: Evaluates sandbox outputs via Inspect tooling.
- `docs/`: Architecture and design memos.

## Contributor Guide
See [`AGENTS.md`](AGENTS.md) for the full contributor workflow, coding style, and PR expectations.
