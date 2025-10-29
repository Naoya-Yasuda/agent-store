#!/usr/bin/env bash
# Build inspect worker image and run evaluation locally
set -euo pipefail

IMAGE=${1:-agent-store/inspect-worker:latest}
ARTIFACTS_DIR=${ARTIFACTS_DIR:-./sandbox-runner/artifacts}

# Step 1: ensure aisev is available
if [ ! -d "third_party/aisev" ]; then
  echo "third_party/aisev not found. Run scripts/setup_aisev.sh first." >&2
  exit 1
fi

# Step 2: build docker image
docker build -t "$IMAGE" -f docker/inspect-worker/Dockerfile .

PYTHON_BIN="${PYTHON_BIN:-python3}"
if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN=".venv/bin/python"
fi

# Step 3: ensure artifacts exist
"$PYTHON_BIN" sandbox-runner/src/sandbox_runner/cli.py \
  --agent-id demo \
  --revision rev1 \
  --template google-adk \
  --output-dir "$ARTIFACTS_DIR" \
  --dry-run \
  --generate-fairness \
  --schema-dir sandbox-runner/schemas \
  --prompt-manifest prompts/aisi/manifest.sample.json

# Step 4: run inspect worker container
docker run --rm \
  -e AGENT_ID=demo \
  -e REVISION=rev1 \
  -e ARTIFACTS_DIR=/data/artifacts \
  -e MANIFEST_PATH=/app/prompts/aisi/manifest.tier3.json \
  -v "$(pwd)/sandbox-runner/artifacts:/data/artifacts" \
  -v "$(pwd)/prompts:/app/prompts" \
  -v "$(pwd)/third_party/aisev:/app/third_party/aisev" \
  "$IMAGE"

# Step 5: show summary
SUMMARY=prototype/inspect-worker/out/demo/rev1/summary.json
if [ -f "$SUMMARY" ]; then
  echo "Inspect summary:"
  cat "$SUMMARY"
else
  echo "Summary not found at $SUMMARY" >&2
  exit 1
fi
