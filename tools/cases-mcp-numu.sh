#!/usr/bin/env bash
# cases-mcp-numu.sh — repoint the `redpash-slack` Cases MCP at numu (consolidation).
#
# WHY: the Cases MCP's `case_*` tools fetch a backend over HTTP. They kept going dark
# because the RedPash :8080 backend is unsupervised and dies. numu now owns the case
# engine (/api/objects/case + /api/objects/comment), so we point the MCP at numu and
# keep numu up here, in one place. The `slack_*` tools are filesystem-only and untouched.
#
# WHAT IT DOES (idempotent):
#   1. Ensures numu-api is listening on :8099 (debug build → dev-login), against numu_dev.
#   2. Repoints the `redpash-slack` MCP env in ~/.claude.json:
#        REDPASH_API_BASE   → http://127.0.0.1:8099/api
#        NUMU_CASES_ADAPTER → "1"            (selects the numu shape adapter)
#        REDPASH_API_SESSION → removed       (the adapter mints its own numu_session)
#      A timestamped backup is written next to the file first.
#
# IMPORTANT: run this with NO Claude Code session live — the running session owns
# ~/.claude.json and will overwrite an in-session edit. So: exit Claude, run this,
# then start a FRESH session (MCP servers load their config at session start).
#
# Durability follow-on: for a hands-off box, install numu-api as a systemd --user
# service instead of the nohup here (see the heredoc at the bottom of this file).
set -euo pipefail

PORT=8099
CFG="${HOME}/.claude.json"
NUMU_DIR="/home/mansa/rust-project/numu"
RP_ENV="/home/mansa/rust-project/redpash-rust-pwa/backend/.env"

# ── 1. ensure numu-api is up on :$PORT ──────────────────────────────────────
if curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1; then
  echo "✓ numu-api already listening on :${PORT}"
else
  echo "→ starting numu-api on :${PORT} (debug = dev-login) against numu_dev …"
  # numu has no .env of its own yet; reuse the PG creds (same server, user, password)
  # from RedPash's .env. Override by exporting DATABASE_URL before running this script.
  if [ -z "${DATABASE_URL:-}" ]; then
    [ -f "$RP_ENV" ] || { echo "✗ need DATABASE_URL (numu_dev) — none set and $RP_ENV missing" >&2; exit 1; }
    set -a; . "$RP_ENV"; set +a
    PGCRED=$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://([^@]+)@.*#\2#')   # user:pass
    DATABASE_URL="postgres://${PGCRED}@127.0.0.1:5433/numu_dev"
  fi
  cd "$NUMU_DIR"
  nohup env DATABASE_URL="$DATABASE_URL" NUMU_BIND="127.0.0.1:${PORT}" NUMU_DEBUG=1 \
        cargo run --bin numu-api > "/tmp/numu-api-${PORT}.log" 2>&1 &
  echo "  numu-api launching (pid $!), log /tmp/numu-api-${PORT}.log"
  printf "  waiting for /readyz "
  until curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1; do printf "."; sleep 1; done
  echo " up"
fi

# ── 2. repoint the redpash-slack MCP env in ~/.claude.json ──────────────────
[ -f "$CFG" ] || { echo "✗ $CFG not found" >&2; exit 1; }
python3 - "$CFG" <<'PY'
import json, sys, shutil, os, time
p = sys.argv[1]
bak = "%s.bak-cases-repoint-%d" % (p, int(time.time()))
shutil.copy(p, bak)
with open(p) as f:
    cfg = json.load(f)
srv = cfg.get("mcpServers", {}).get("redpash-slack")
if not srv:
    print("✗ mcpServers.redpash-slack not present in", p); sys.exit(1)
env = srv.setdefault("env", {})
env["REDPASH_API_BASE"]   = "http://127.0.0.1:8099/api"
env["NUMU_CASES_ADAPTER"] = "1"
env.pop("REDPASH_API_SESSION", None)
with open(p, "w") as f:
    json.dump(cfg, f, indent=2)
print("✓ repointed redpash-slack → numu :8099  (backup: %s)" % bak)
PY

echo
echo "DONE. Start a fresh Claude Code session; the Cases MCP now talks to numu."
echo "Verify with: case_list  (then case_create → case_comment → case_set_status)."

# ── durable option (systemd --user) — install once, then this script is just the repoint ──
: <<'SYSTEMD'
# ~/.config/systemd/user/numu-api.service
[Unit]
Description=numu-api (Cases backend on :8099)
After=network.target

[Service]
WorkingDirectory=/home/mansa/rust-project/numu
Environment=DATABASE_URL=postgres://USER:PASS@127.0.0.1:5433/numu_dev
Environment=NUMU_BIND=127.0.0.1:8099
Environment=NUMU_DEBUG=1
ExecStart=/home/mansa/.cargo/bin/cargo run --release --bin numu-api
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
# Then: systemctl --user daemon-reload && systemctl --user enable --now numu-api
#       loginctl enable-linger mansa   # survive logout
SYSTEMD
