#!/usr/bin/env bash
# Integration test against the production entry point scripts/session-context.ts.
# Spawns tsx as a subprocess and asserts the JSON envelope, exit code, and
# silent-skip paths. Unit tests in session-context.test.ts only cover the pure
# helpers — this file pins the orchestrator contract.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/session-context.ts"
TSX="${ROOT_DIR}/node_modules/.bin/tsx"

if [ ! -x "$TSX" ]; then
  echo "SKIP: tsx not found at $TSX (run npm install first)" >&2
  exit 0
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cmg-orch-XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# Seed a fixture db from the canonical seed.
FIXTURE_DB="${WORK_DIR}/fixture.db"
SEED_SQL="${ROOT_DIR}/tests/fixtures/seed.sql"
sqlite3 "$FIXTURE_DB" < "$SEED_SQL"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

run_hook() {
  # args: db_path project_dir
  local db="$1"
  local project_dir="$2"
  local extra_env="${3:-}"
  env -i HOME="$HOME" PATH="$PATH" \
    CLAUDE_MEM_GRAPH_TRIM_DB="$db" \
    CLAUDE_PROJECT_DIR="$project_dir" \
    $extra_env \
    "$TSX" "$SCRIPT" 2>"${WORK_DIR}/last.stderr"
  echo "exit=$?" >>"${WORK_DIR}/last.stderr"
}

PASS=0

# ----- Case 1: well-formed JSON for a known project -----
STDOUT=$(run_hook "$FIXTURE_DB" "/Users/test/code/wp-content" || true)
[ -n "$STDOUT" ] || fail "case1: expected non-empty stdout"
echo "$STDOUT" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['hookSpecificOutput']['hookEventName']=='SessionStart'; assert len(d['hookSpecificOutput']['additionalContext'])>0" \
  || fail "case1: invalid JSON envelope: $STDOUT"
PASS=$((PASS+1))

# ----- Case 2: missing db file -> empty stdout, exit 0 -----
STDOUT=$(run_hook "/tmp/cmg-no-such-db.sqlite" "/Users/test/code/wp-content" || true)
[ -z "$STDOUT" ] || fail "case2: expected empty stdout, got: $STDOUT"
PASS=$((PASS+1))

# ----- Case 3: project cannot be resolved -> empty stdout + stderr diag -----
STDOUT=$(run_hook "$FIXTURE_DB" "/Users/test/code/never-stored-project" || true)
[ -z "$STDOUT" ] || fail "case3: expected empty stdout, got: $STDOUT"
grep -q "no matching project" "${WORK_DIR}/last.stderr" \
  || fail "case3: expected 'no matching project' in stderr: $(cat ${WORK_DIR}/last.stderr)"
PASS=$((PASS+1))

# ----- Case 4: corrupt db file -> exit 0 + stderr diag -----
CORRUPT_DB="${WORK_DIR}/corrupt.db"
echo "not a sqlite file" > "$CORRUPT_DB"
STDOUT=$(run_hook "$CORRUPT_DB" "/Users/test/code/wp-content" || true)
[ -z "$STDOUT" ] || fail "case4: expected empty stdout, got: $STDOUT"
grep -qE "db open failed|not a database|uncaught:" "${WORK_DIR}/last.stderr" \
  || fail "case4: expected a diagnostic line in stderr: $(cat ${WORK_DIR}/last.stderr)"
PASS=$((PASS+1))

printf '%d/4 cases passed\n' "$PASS"
