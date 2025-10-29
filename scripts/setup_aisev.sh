#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Japan-AISI/aisev"
TARGET_DIR="third_party/aisev"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "[setup_aisev] Repository already cloned at $TARGET_DIR"
  exit 0
fi

mkdir -p third_party
cd third_party

git clone "$REPO_URL"

cd aisev

if [ -f requirements.txt ]; then
  python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
  deactivate
fi

echo "[setup_aisev] Clone completed. Inspect workers can reference third_party/aisev"
