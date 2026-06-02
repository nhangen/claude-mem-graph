import Database from 'better-sqlite3';
import type { ObservationRow, SessionRow, Observation, Session } from './types.js';
import { SUPPORTED_SCHEMA_VERSIONS as VERSIONS, DEFAULT_DB_PATH } from './types.js';

export interface LoadStats {
  malformed: Record<string, number>;
}

export function createLoadStats(): LoadStats {
  return { malformed: {} };
}

interface ParseCtx {
  id: number;
  field: string;
  stats: LoadStats;
}

function recordMalformed(ctx: ParseCtx | undefined, raw: unknown, reason: string): void {
  if (!ctx) return;
  ctx.stats.malformed[ctx.field] = (ctx.stats.malformed[ctx.field] ?? 0) + 1;
  const snippet = typeof raw === 'string' ? raw.slice(0, 80) : String(raw).slice(0, 80);
  process.stderr.write(
    `[claude-mem-graph] malformed ${ctx.field} on observation #${ctx.id} (${reason}): ${snippet}\n`,
  );
}

function parseJsonArray(raw: string | null, ctx?: ParseCtx): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    recordMalformed(ctx, raw, 'not-array');
    return [];
  } catch {
    recordMalformed(ctx, raw, 'parse-error');
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined, ctx?: ParseCtx): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    recordMalformed(ctx, raw, 'not-object');
    return {};
  } catch {
    recordMalformed(ctx, raw, 'parse-error');
    return {};
  }
}

function toObservation(row: ObservationRow, stats?: LoadStats): Observation {
  const mk = (field: string): ParseCtx | undefined =>
    stats ? { id: row.id, field, stats } : undefined;
  return {
    id: row.id,
    sessionId: row.memory_session_id,
    project: row.project,
    type: row.type,
    title: row.title ?? `Observation #${row.id}`,
    subtitle: row.subtitle ?? '',
    narrative: row.narrative ?? '',
    text: row.text ?? '',
    facts: row.facts ?? '',
    concepts: parseJsonArray(row.concepts, mk('concepts')),
    filesRead: parseJsonArray(row.files_read, mk('files_read')),
    filesModified: parseJsonArray(row.files_modified, mk('files_modified')),
    promptNumber: row.prompt_number,
    relevanceCount: row.relevance_count ?? 0,
    createdAt: row.created_at_epoch,
    metadata: parseJsonObject(row.metadata, mk('metadata')),
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    contentSessionId: row.content_session_id,
    memorySessionId: row.memory_session_id,
    project: row.project,
    startedAt: row.started_at_epoch,
    completedAt: row.completed_at_epoch,
    status: row.status,
  };
}

export function validateSchemaVersion(db: Database.Database): void {
  let maxVersion: number;
  try {
    const row = db.prepare('SELECT MAX(version) as max_version FROM schema_versions').get() as
      { max_version: number } | undefined;
    maxVersion = row?.max_version ?? 0;
  } catch {
    throw new Error(
      'claude-mem database missing schema_versions table. Is this a valid claude-mem DB?'
    );
  }
  if (maxVersion < VERSIONS.min || maxVersion > VERSIONS.max) {
    throw new Error(
      `claude-mem schema version ${maxVersion} is outside supported range ` +
      `(${VERSIONS.min}-${VERSIONS.max}). Update claude-mem-graph to support this version.`
    );
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

export function loadObservations(db: Database.Database, stats?: LoadStats): Observation[] {
  const baseCols = `id, memory_session_id, project, type, title, subtitle, narrative, text, facts,
            concepts, files_read, files_modified, prompt_number, relevance_count, created_at_epoch`;
  const metadataCol = hasColumn(db, 'observations', 'metadata') ? ', metadata' : '';
  const rows = db.prepare(
    `SELECT ${baseCols}${metadataCol}
     FROM observations
     ORDER BY created_at_epoch ASC`
  ).all() as ObservationRow[];
  return rows.map((row) => toObservation(row, stats));
}

export function loadSessions(db: Database.Database): Session[] {
  const rows = db.prepare(
    `SELECT id, content_session_id, memory_session_id, project,
            started_at_epoch, completed_at_epoch, status
     FROM sdk_sessions
     ORDER BY started_at_epoch ASC`
  ).all() as SessionRow[];
  return rows.map(toSession);
}

export function openDatabase(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(dbPath, { readonly: true });
  db.pragma('query_only = ON');
  validateSchemaVersion(db);
  return db;
}
