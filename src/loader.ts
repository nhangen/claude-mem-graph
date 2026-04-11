import Database from 'better-sqlite3';
import type { ObservationRow, SessionRow, Observation, Session } from './types.js';
import { SUPPORTED_SCHEMA_VERSIONS as VERSIONS, DEFAULT_DB_PATH } from './types.js';

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    sessionId: row.memory_session_id,
    project: row.project,
    type: row.type,
    title: row.title ?? `Observation #${row.id}`,
    concepts: parseJsonArray(row.concepts),
    filesRead: parseJsonArray(row.files_read),
    filesModified: parseJsonArray(row.files_modified),
    promptNumber: row.prompt_number,
    relevanceCount: row.relevance_count ?? 0,
    createdAt: row.created_at_epoch,
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

export function loadObservations(db: Database.Database): Observation[] {
  const rows = db.prepare(
    `SELECT id, memory_session_id, project, type, title, subtitle, narrative, text, facts,
            concepts, files_read, files_modified, prompt_number, relevance_count, created_at_epoch
     FROM observations
     ORDER BY created_at_epoch ASC`
  ).all() as ObservationRow[];
  return rows.map(toObservation);
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
