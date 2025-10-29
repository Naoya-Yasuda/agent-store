#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

for file in db/migrations/*.sql; do
  echo "Applying migration $file"
  psql "$DATABASE_URL" -f "$file"
done
