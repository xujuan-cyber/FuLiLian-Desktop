#!/usr/bin/env bash
# scripts/gate/probe-a4.sh — negative control for the ruff gate (A4).
#
# A gate that has never been seen to fail is not evidence of anything.  This
# script replays the exact defect that motivated the gate: f4e2eb0 shipped
# five debug prints in tui_gateway/ws.py, one of which reads
# sys.modules.get(...) in a module that never does `import sys`.  Nothing
# failed at import time — the NameError only fires on the ready path, on a
# client that connects, on a machine someone happens to be watching.
#
# Procedure, entirely inside a scratch copy (the working tree is never touched):
#   1. copy pyproject.toml + tui_gateway/ws.py into $PROBE
#   2. ruff check .            -> must be GREEN
#   3. inject the five print lines -> ruff check . -> must be RED with F821
#   4. restore the pristine copy   -> ruff check . -> must be GREEN again
#
# Exit 0 only when all three expectations hold.
#
# Usage: bash scripts/gate/probe-a4.sh [probe-dir]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE="${1:-${TMPDIR:-/tmp}/gate-probe}"

unset PYTHONPATH CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR CODEBUDDY_TOOL_CALL_ID

PY=""
for cand in "$REPO_ROOT/venv/Scripts/python.exe" "$REPO_ROOT/venv/bin/python"; do
  if [ -x "$cand" ]; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then PY="$(command -v python3 || command -v python || true)"; fi
[ -n "$PY" ] || { echo "probe-a4: no python interpreter" >&2; exit 2; }

rm -rf "$PROBE"
mkdir -p "$PROBE/tui_gateway"
cp "$REPO_ROOT/pyproject.toml" "$PROBE/pyproject.toml"
cp "$REPO_ROOT/tui_gateway/ws.py" "$PROBE/tui_gateway/ws.py"

FAILURES=0
step() { printf '\n== %s ==\n' "$1"; }
verdict() { # description expected(0|1) actual
  if [ "$2" -eq "$3" ]; then
    printf '  RESULT: PASS (%s)\n' "$1"
  else
    printf '  RESULT: FAIL (%s; expected exit %s, got %s)\n' "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}

step "1/3 pristine copy"
( cd "$PROBE" && "$PY" -m ruff check . )
verdict "pristine ws.py must be clean (gate green before the defect)" 0 $?

step "2/3 inject f4e2eb0 debug residue"
"$PY" - "$PROBE/tui_gateway/ws.py" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as fh:
    lines = fh.readlines()

anchor = "        if ready_ok:\n"
hits = [i for i, line in enumerate(lines) if line == anchor]
if len(hits) != 1:
    sys.exit(f"probe-a4: expected exactly one {anchor!r} anchor, found {len(hits)}")

residue = [
    '        print("DBG_READY_OK:", ready_ok)\n',
    '        print("DBG_BEFORE_WATCHER")\n',
    '        print("DBG_AFTER_WATCHER")\n',
    '        print("DBG_SERVER_ID:", id(server), server.__name__ if hasattr(server, "__name__") else type(server))\n',
    '        print("DBG_FN_ID:", id(server.register_live_transport), "| SYSMOD_ID:", id(sys.modules.get("tui_gateway.server")), "| SAME:", sys.modules.get("tui_gateway.server") is server)\n',
]
lines[hits[0]:hits[0]] = residue
with open(path, "w", encoding="utf-8", newline="") as fh:
    fh.writelines(lines)
print(f"  injected {len(residue)} lines before line {hits[0] + 1}")
PY
[ $? -eq 0 ] || { echo "  RESULT: FAIL (could not inject residue)"; FAILURES=$((FAILURES + 1)); }

( cd "$PROBE" && "$PY" -m ruff check . )
rc=$?
( cd "$PROBE" && "$PY" -m ruff check . --select F821 >/dev/null 2>&1 )
f821_rc=$?
if [ "$f821_rc" -ne 0 ]; then
  echo "  F821 is reported on the mutant — the gate can see this class of bug."
else
  echo "  F821 is NOT reported on the mutant."
fi
verdict "mutant must be rejected (gate red after the defect)" 1 "$rc"
if [ "$f821_rc" -eq 0 ]; then
  echo "  RESULT: FAIL (red, but not for F821 — the rule did not catch it)"
  FAILURES=$((FAILURES + 1))
fi

step "3/3 restore pristine copy"
cp "$REPO_ROOT/tui_gateway/ws.py" "$PROBE/tui_gateway/ws.py"
( cd "$PROBE" && "$PY" -m ruff check . )
verdict "restored ws.py must be clean again (gate green)" 0 $?

printf '\nprobe dir: %s\n' "$PROBE"
if [ "$FAILURES" -ne 0 ]; then
  printf 'PROBE A4: FAIL (%s failed expectation(s))\n' "$FAILURES"
  exit 1
fi
printf 'PROBE A4: PASS (green -> red on mutant -> green again)\n'
