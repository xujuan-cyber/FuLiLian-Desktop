#!/usr/bin/env bash
# scripts/gate/run.sh — local pre-merge gate.
#
# Why this exists: the GitHub Actions jobs in .github/workflows/lint.yml are
# the real gate, but they only run on pushed commits.  A local branch can sit
# dozens of commits ahead of origin/main with a blocking job that has never
# executed once — which is exactly how f4e2eb0 landed a name that only fails
# at runtime.  This script runs the same four checks before a merge, on this
# machine, without needing CI or a push.
#
# Gates, in order (fail fast is NOT used on purpose — one run should tell you
# every red, not just the first):
#   1. env     — pytest-asyncio importable (dev extra installed)
#   2. ruff    — `ruff check .` must be clean (PLW1514 + E9/F63/F7/F82)
#   3. types   — `npm run typecheck` in apps/desktop
#   4. lint    — eslint on every file this branch touched; only NEW problems
#                count (per-file attribution against HEAD, see D7)
#   5. tests   — the TUI-gateway WS/protocol suite that covers runtime
#                registration (the class of bug ruff cannot see)
#
# Usage:
#   bash scripts/gate/run.sh                  # all gates
#   bash scripts/gate/run.sh --only=ruff      # triage: comma-separated subset
#
# Exit code: 0 only when every executed gate is green.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# The WorkBuddy sandbox exports a PYTHONPATH shim plus a safe-delete shim that
# aborts the interpreter when a test deletes more than N files.  Inheriting
# either turns a green suite into a fake failure, so drop them unconditionally.
unset PYTHONPATH CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR CODEBUDDY_TOOL_CALL_ID

ONLY=""
for arg in "$@"; do
  case "$arg" in
    --only=*) ONLY="${arg#--only=}" ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "gate: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# --- interpreter -----------------------------------------------------------
PY=""
for cand in "$REPO_ROOT/venv/Scripts/python.exe" "$REPO_ROOT/venv/bin/python"; do
  if [ -x "$cand" ]; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  PY="$(command -v python3 || command -v python || true)"
fi
if [ -z "$PY" ]; then
  echo "gate: no Python interpreter found (looked for venv/Scripts/python.exe, venv/bin/python, python3)" >&2
  exit 2
fi

GATE_NAMES=()
GATE_STATUS=()
GATE_REPRO=()

record() { # name status repro
  GATE_NAMES+=("$1")
  GATE_STATUS+=("$2")
  GATE_REPRO+=("$3")
}

wanted() { # gate-id
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

hr() { printf '%s\n' "------------------------------------------------------------"; }

# --- gate 1: dev extra preflight -------------------------------------------
# Not a product defect: the venv simply may not have the dev extra installed.
# Without it 21 test modules fail to even collect, which looks like a code
# problem and wastes an hour.  Fail here with the exact fix instead.
if wanted env; then
  hr
  echo "[gate 1/5] env: pytest-asyncio importable"
  if "$PY" -c 'import pytest_asyncio' >/dev/null 2>&1; then
    echo "  ok ($("$PY" -c 'import pytest_asyncio; print("pytest-asyncio", pytest_asyncio.__version__)' 2>/dev/null))"
    record env PASS ""
  else
    echo "  FAIL: pytest-asyncio is not installed in $PY"
    echo "  This is an environment precondition, not a product defect. Fix with:"
    echo "    ./venv/Scripts/python.exe -m pip install -e \".[dev]\""
    echo "  (or, to avoid reinstalling everything: -m pip install pytest-asyncio==1.3.0)"
    record env FAIL "./venv/Scripts/python.exe -m pip install -e \".[dev]\""
  fi
fi

# --- gate 2: ruff -------------------------------------------------------------------
if wanted ruff; then
  hr
  echo "[gate 2/5] ruff: check . (PLW1514 + E9/F63/F7/F82)"
  if "$PY" -m ruff check .; then
    record ruff PASS ""
  else
    echo "  FAIL: ruff found blocking findings (see above)"
    record ruff FAIL "./venv/Scripts/python.exe -m ruff check ."
  fi
fi

# --- gate 3: typecheck -----------------------------------------------------------------
if wanted typecheck; then
  hr
  echo "[gate 3/5] types: npm run typecheck (apps/desktop)"
  if ( cd apps/desktop && npm run typecheck ); then
    record typecheck PASS ""
  else
    echo "  FAIL: tsc reported errors (see above)"
    record typecheck FAIL "cd apps/desktop && npm run typecheck"
  fi
fi

# --- gate 4: lint delta ---------------------------------------------------------------
# Absolute eslint counts drift whenever any window touches TS, so the judging
# rule is per-file attribution: lint the working tree and the HEAD copy of the
# same file, and only a *new* finding blocks (方案 D7).  No git stash anywhere.
if wanted lint; then
  hr
  echo "[gate 4/5] lint: eslint delta vs HEAD (new findings only)"
  if node "$REPO_ROOT/scripts/gate/lint_delta.mjs"; then
    record lint PASS ""
  else
    echo "  FAIL: this branch introduced new eslint findings (see above)"
    record lint FAIL "node scripts/gate/lint_delta.mjs"
  fi
fi

# --- gate 5: targeted backend tests ----------------------------------------------------
if wanted tests; then
  hr
  echo "[gate 5/5] tests: TUI gateway WS + protocol"
  if ( cd "$REPO_ROOT" && "$PY" -m pytest tests/test_tui_gateway_ws.py tests/tui_gateway/test_protocol.py -q -p no:cacheprovider ); then
    record tests PASS ""
  else
    echo "  FAIL: targeted backend tests failed (see above)"
    record tests FAIL "./venv/Scripts/python.exe -m pytest tests/test_tui_gateway_ws.py tests/tui_gateway/test_protocol.py -q -p no:cacheprovider"
  fi
fi

# --- summary ---------------------------------------------------------------------------
hr
echo "GATE SUMMARY"
FAIL_COUNT=0
for i in "${!GATE_NAMES[@]}"; do
  name="${GATE_NAMES[$i]}"
  status="${GATE_STATUS[$i]}"
  if [ "$status" = "PASS" ]; then
    printf '  %-10s PASS\n' "$name"
  else
    printf '  %-10s FAIL\n' "$name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

if [ -n "$ONLY" ]; then
  echo "  (partial run: --only=$ONLY)"
fi

if [ "$FAIL_COUNT" -ne 0 ]; then
  hr
  echo "RED — reproduce with:"
  for i in "${!GATE_NAMES[@]}"; do
    if [ "${GATE_STATUS[$i]}" != "PASS" ]; then
      echo "  ${GATE_NAMES[$i]}: ${GATE_REPRO[$i]}"
    fi
  done
  exit 1
fi

hr
echo "GREEN — all executed gates passed."
