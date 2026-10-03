#!/usr/bin/env bash
# Build apps/web and rsync ONLY the /lite tree into Collie's static dir.
# Idempotent. Never deletes or rewrites anything outside web/dist/lite/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${COLLIE_WEB_DIST:-"$HOME/.local/share/collie/web/dist"}/lite"

cd "$ROOT"
bun run --filter @homeling/web build

mkdir -p "$DEST"
# --delete is scoped to $DEST (the lite directory), not web/dist.
rsync -a --delete "$ROOT/apps/web/dist/" "$DEST/"
echo "[deploy-web] $DEST"
