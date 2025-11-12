#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../prototype/inspect-worker"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null
pip install pytest >/dev/null
python -m pytest "$@"
