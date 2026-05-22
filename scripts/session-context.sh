#!/usr/bin/env bash
# session-context.sh
# Bash entrypoint for the SessionStart hook. Resolves tsx from PATH or the
# plugin's local node_modules and runs session-context.ts. Always exits 0
# so a failure here never blocks session startup.

set -u

PLUGIN_DIR="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPT="$PLUGIN_DIR/scripts/session-context.ts"

if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

if command -v tsx >/dev/null 2>&1; then
  TSX_BIN="tsx"
elif [ -x "$PLUGIN_DIR/node_modules/.bin/tsx" ]; then
  TSX_BIN="$PLUGIN_DIR/node_modules/.bin/tsx"
else
  exit 0
fi

"$TSX_BIN" "$SCRIPT" || true
exit 0
