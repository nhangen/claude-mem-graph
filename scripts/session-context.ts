#!/usr/bin/env tsx
// SessionStart hook entrypoint. Emits a compact additionalContext block
// derived from the N most recent claude-mem observations for the current
// project, with optional recency gating.
//
// Configured via env:
//   CLAUDE_MEM_GRAPH_TRIM_N      — max observations to include (default 10)
//   CLAUDE_MEM_GRAPH_TRIM_HOURS  — recency window in hours (default 24).
//                                  When the window is empty, falls back to
//                                  the top-N most recent across all time.
//   CLAUDE_MEM_GRAPH_TRIM_DB     — override default db path
//
// Always exits 0 so session start is never blocked by this hook.

import { existsSync, readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { DEFAULT_DB_PATH } from '../src/types.js';
import {
  selectObservations,
  formatContext,
  detectProjectFromCwd,
  parsePositiveInt,
} from '../src/session-context.js';

function drainStdin(): void {
  try {
    readFileSync(0, 'utf-8');
  } catch {
    // hook protocol passes JSON on stdin; we don't need the payload.
  }
}

function main(): void {
  drainStdin();

  const dbPath = process.env.CLAUDE_MEM_GRAPH_TRIM_DB || DEFAULT_DB_PATH;
  if (!existsSync(dbPath)) return;

  const limit = parsePositiveInt(process.env.CLAUDE_MEM_GRAPH_TRIM_N, 10);
  const windowHours = parsePositiveInt(process.env.CLAUDE_MEM_GRAPH_TRIM_HOURS, 24);
  const project = detectProjectFromCwd(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!project) return;

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
    db.pragma('query_only = ON');
  } catch {
    return;
  }

  try {
    const result = selectObservations(db, { project, limit, windowHours });
    const additionalContext = formatContext(result);
    if (!additionalContext) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    }));
  } finally {
    db.close();
  }
}

try {
  main();
} catch {
  // Hook must never break session start.
}
