#!/usr/bin/env bash
# Build apps/web into apps/web/dist (local build verification only).
# Zero-touch (ADR-0004): the daemon serves this dist directory itself at /lite/ —
# nothing here copies into or otherwise touches ~/.local/share/collie.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
bun install --frozen-lockfile
bun run --filter '@homeling/web' build

echo "[build-web] output: $ROOT/apps/web/dist"
