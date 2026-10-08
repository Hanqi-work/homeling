#!/usr/bin/env bash
# Canary for the zero-touch invariant (ADR-0004): Homeling must never touch the Collie
# checkout or its tailscale serve root handler.
#
# Two-phase:
#   canary.sh save   — before a deploy, snapshot the protected state.
#   canary.sh check  — after a deploy (and any time), compare against the snapshot.
#
# Checked invariants:
#   1. `git -C ~/.local/share/collie status --porcelain` is empty.
#   2. `bin/collie` mtime + sha256 are unchanged (the binary was not rebuilt/replaced).
#   3. `tailscale serve` root handler `/` still proxies to :8787 (never rewritten).
#
# Optional health request runs only with HOMELING_CANARY_DAEMON_URL set.
# This script does not restart the daemon or verify that a restart occurred.
set -uo pipefail

COLLIE_DIR="${COLLIE_DIR:-$HOME/.local/share/collie}"
SERVE_ROOT_PROXY="${SERVE_ROOT_PROXY:-http://127.0.0.1:8787}"
STATE_FILE="${HOMELING_CANARY_STATE:-${TMPDIR:-/tmp}/homeling-canary-state.env}"

fail() { echo "[canary] FAIL: $*" >&2; exit 1; }

snap() {
  git -C "$COLLIE_DIR" rev-parse HEAD 2>/dev/null || echo "no-git"
}

collie_fingerprint() {
  local bin="$COLLIE_DIR/bin/collie"
  [ -f "$bin" ] || { echo "missing"; return; }
  echo "$(stat -f %m "$bin" 2>/dev/null || stat -c %Y "$bin") $(shasum -a 256 "$bin" | cut -d' ' -f1)"
}

root_handler() {
  # The `/` handler of the sole serve listener; empty output means it is gone or unreadable.
  tailscale serve status --json 2>/dev/null | bun -e '
    const raw = await new Response(Bun.stdin.stream()).text();
    try {
      const j = JSON.parse(raw);
      for (const web of Object.values(j.Web ?? {})) {
        const h = web.Handlers?.["/"];
        if (h?.Proxy) { console.log(h.Proxy); process.exit(0); }
      }
    } catch {}
    process.exit(1);
  '
}

cmd_save() {
  [ -d "$COLLIE_DIR" ] || fail "collie dir not found: $COLLIE_DIR"
  local root; root=$(root_handler)
  [ -n "$root" ] || fail "cannot read tailscale serve root handler — is tailscale running?"
  cat > "$STATE_FILE" <<EOF
COLLIE_HEAD='$(snap)'
COLLIE_BIN='$(collie_fingerprint)'
ROOT_HANDLER='$root'
EOF
  echo "[canary] saved state to $STATE_FILE"
  echo "[canary]   collie HEAD: $(snap)"
  echo "[canary]   bin/collie:  $(collie_fingerprint)"
  echo "[canary]   root /:      $root"
}

cmd_check() {
  [ -f "$STATE_FILE" ] || fail "no saved state at $STATE_FILE — run 'canary.sh save' first"
  # shellcheck disable=SC1090
  source "$STATE_FILE"

  local rc=0

  local dirty; dirty=$(git -C "$COLLIE_DIR" status --porcelain 2>/dev/null)
  if [ -n "$dirty" ]; then
    echo "[canary] FAIL: collie checkout is dirty:"
    echo "$dirty" | sed 's/^/[canary]   /'
    rc=1
  else
    echo "[canary] ok: collie checkout clean"
  fi

  local now_bin; now_bin=$(collie_fingerprint)
  if [ "$now_bin" != "$COLLIE_BIN" ]; then
    echo "[canary] FAIL: bin/collie changed:"
    echo "[canary]   was: $COLLIE_BIN"
    echo "[canary]   now: $now_bin"
    rc=1
  else
    echo "[canary] ok: bin/collie untouched"
  fi

  local now_root; now_root=$(root_handler)
  if [ "$now_root" != "$ROOT_HANDLER" ]; then
    echo "[canary] FAIL: tailscale serve root handler changed:"
    echo "[canary]   was: $ROOT_HANDLER"
    echo "[canary]   now: $now_root"
    rc=1
  else
    echo "[canary] ok: root handler $now_root"
  fi

  if [ -n "${HOMELING_CANARY_DAEMON_URL:-}" ]; then
    if curl -fsS --max-time 5 "$HOMELING_CANARY_DAEMON_URL/lite/api/health" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
      echo "[canary] ok: daemon /lite/api/health responds"
    else
      echo "[canary] FAIL: daemon not healthy at $HOMELING_CANARY_DAEMON_URL"
      rc=1
    fi
  fi

  if [ "$rc" -eq 0 ]; then echo "[canary] all invariants hold"; else echo "[canary] INVARIANT VIOLATION"; fi
  exit "$rc"
}

case "${1:-}" in
  save) cmd_save ;;
  check) cmd_check ;;
  *) echo "usage: canary.sh save|check" >&2; exit 2 ;;
esac
