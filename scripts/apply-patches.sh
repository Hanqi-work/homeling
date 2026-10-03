#!/usr/bin/env bash
# Re-apply homeling's additive Collie patches. No git writes (no commit, checkout, or update).
# `patch` refuses to re-apply a hunk that is already present, so a second run is a no-op failure
# per file that was already applied — that is reported, not hidden.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COLLIE="${COLLIE_DIR:-"$HOME/.local/share/collie"}"
shopt -s nullglob
patches=("$ROOT"/patches/*.patch)
if ((${#patches[@]} == 0)); then
  echo "[apply-patches] no patches"
  exit 0
fi
for p in "${patches[@]}"; do
  name="$(basename "$p")"
  if patch -d "$COLLIE" -p1 --forward --dry-run --silent <"$p" >/dev/null 2>&1; then
    patch -d "$COLLIE" -p1 --forward --batch --silent <"$p"
    echo "[apply-patches] applied $name"
  else
    echo "[apply-patches] already applied, skip $name"
  fi
done
