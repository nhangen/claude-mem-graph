import type Database from 'better-sqlite3';
import type { ObservationRow } from './types.js';

export interface SelectOptions {
  project: string;
  limit: number;
  windowHours: number;
  now?: number;
}

export interface SelectResult {
  rows: ObservationRow[];
  windowHit: boolean;
  totalAvailable: number;
}

const OBS_COLUMNS = `id, memory_session_id, project, type, title, subtitle, narrative, text, facts,
  concepts, files_read, files_modified, prompt_number, relevance_count, created_at_epoch`;

export function selectObservations(db: Database.Database, opts: SelectOptions): SelectResult {
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.windowHours * 60 * 60 * 1000;

  const total = (db.prepare(
    `SELECT COUNT(*) as c FROM observations WHERE project = ?`
  ).get(opts.project) as { c: number } | undefined)?.c ?? 0;
  if (total === 0) return { rows: [], windowHit: false, totalAvailable: 0 };

  const inWindow = db.prepare(
    `SELECT ${OBS_COLUMNS}
     FROM observations
     WHERE project = ? AND created_at_epoch >= ?
     ORDER BY created_at_epoch DESC
     LIMIT ?`
  ).all(opts.project, cutoff, opts.limit) as ObservationRow[];

  if (inWindow.length > 0) {
    return { rows: inWindow, windowHit: true, totalAvailable: total };
  }

  const fallback = db.prepare(
    `SELECT ${OBS_COLUMNS}
     FROM observations
     WHERE project = ?
     ORDER BY created_at_epoch DESC
     LIMIT ?`
  ).all(opts.project, opts.limit) as ObservationRow[];

  return { rows: fallback, windowHit: false, totalAvailable: total };
}

export function formatContext(result: SelectResult): string {
  const { rows, windowHit, totalAvailable } = result;
  if (rows.length === 0) return '';
  const header = windowHit
    ? `# claude-mem-graph (recent, ${rows.length} of ${totalAvailable} in window)`
    : `# claude-mem-graph (top ${rows.length} of ${totalAvailable}, no recent activity)`;
  const lines = rows.map(r => {
    const date = new Date(r.created_at_epoch).toISOString().slice(0, 10);
    const title = r.title ?? `Observation #${r.id}`;
    return `- [${date}] #${r.id} ${r.type}: ${title}`;
  });
  const footer = totalAvailable > rows.length
    ? `\nOlder context available via mem-search or claude-mem-graph MCP tools (${totalAvailable - rows.length} more).`
    : '';
  return [header, '', ...lines, footer].join('\n');
}

export function detectProjectFromCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const parts = cwd.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
