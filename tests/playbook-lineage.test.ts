import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { loadObservations, loadSessions } from '../src/loader.js';
import { buildGraph } from '../src/graph.js';
import { queryPlaybookLineage } from '../src/query.js';

function buildDb(opts: { withMetadata: boolean }): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'cmg-pl-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  db.prepare(`CREATE TABLE schema_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER, created_at TEXT)`).run();
  db.prepare(`INSERT INTO schema_versions (version, created_at) VALUES (29, '2026-01-01T00:00:00Z')`).run();
  db.prepare(`CREATE TABLE sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT NOT NULL, memory_session_id TEXT,
      project TEXT NOT NULL,
      started_at TEXT NOT NULL, started_at_epoch INTEGER NOT NULL,
      completed_at TEXT, completed_at_epoch INTEGER,
      status TEXT NOT NULL
    )`).run();
  db.prepare(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
      VALUES ('c-1', 'mem-1', 'p', '2026-06-01T10:00:00Z', 1748775600000, 'completed')`).run();
  db.prepare(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
      VALUES ('c-2', 'mem-2', 'p', '2026-06-02T10:00:00Z', 1748862000000, 'completed')`).run();
  const metadataCol = opts.withMetadata ? ',\n      metadata TEXT' : '';
  db.prepare(`CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT, subtitle TEXT, narrative TEXT, text TEXT, facts TEXT,
      concepts TEXT, files_read TEXT, files_modified TEXT,
      prompt_number INTEGER,
      relevance_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL${metadataCol}
    )`).run();
  return db;
}

function insertObs(
  db: Database.Database,
  o: {
    id: number; session: string; project?: string;
    title: string; files?: string[]; ts: number;
    metadata?: Record<string, unknown> | null;
  },
  withMetadata: boolean,
): void {
  const cols = ['id', 'memory_session_id', 'project', 'type', 'title',
    'concepts', 'files_read', 'files_modified', 'prompt_number',
    'created_at', 'created_at_epoch'];
  const vals: unknown[] = [
    o.id, o.session, o.project ?? 'p', 'change', o.title,
    '[]', '[]', JSON.stringify(o.files ?? []), 1,
    new Date(o.ts).toISOString(), o.ts,
  ];
  if (withMetadata) {
    cols.push('metadata');
    vals.push(o.metadata === null ? null : JSON.stringify(o.metadata ?? {}));
  }
  const placeholders = vals.map(() => '?').join(', ');
  db.prepare(`INSERT INTO observations (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
}

describe('queryPlaybookLineage', () => {
  it('returns matched observations grouped into runs by sessionId, sorted ascending', () => {
    const db = buildDb({ withMetadata: true });
    insertObs(db, { id: 1, session: 'mem-1', title: 'A1', ts: 1748775600000, files: ['x.ts'],
      metadata: { playbook_id: 'morning-scan' } }, true);
    insertObs(db, { id: 2, session: 'mem-1', title: 'A2', ts: 1748775700000, files: ['y.ts'],
      metadata: { playbook_id: 'morning-scan' } }, true);
    insertObs(db, { id: 3, session: 'mem-2', title: 'B1', ts: 1748862000000, files: ['z.ts'],
      metadata: { playbook_id: 'morning-scan' } }, true);
    insertObs(db, { id: 4, session: 'mem-1', title: 'other-pb', ts: 1748775800000,
      metadata: { playbook_id: 'evening-scan' } }, true);
    insertObs(db, { id: 5, session: 'mem-1', title: 'nometa', ts: 1748775900000,
      metadata: null }, true);

    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    const graph = buildGraph(observations, sessions);

    const result = queryPlaybookLineage(graph, { name: 'morning-scan' });
    expect(result.matchedCount).toBe(3);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].sessionId).toBe('mem-1');
    expect(result.runs[0].observations.map((o) => o.id)).toEqual([1, 2]);
    expect(result.runs[1].sessionId).toBe('mem-2');
    expect(result.runs[1].observations.map((o) => o.id)).toEqual([3]);
    expect(result.sessionsTouched).toEqual(['mem-1', 'mem-2']);
    expect(result.filesTouched.sort()).toEqual(['x.ts', 'y.ts', 'z.ts']);
  });

  it('returns empty result when no observations match', () => {
    const db = buildDb({ withMetadata: true });
    insertObs(db, { id: 1, session: 'mem-1', title: 'A1', ts: 1748775600000,
      metadata: { playbook_id: 'other' } }, true);
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    const graph = buildGraph(observations, sessions);

    const result = queryPlaybookLineage(graph, { name: 'missing' });
    expect(result.matchedCount).toBe(0);
    expect(result.runs).toEqual([]);
    expect(result.sessionsTouched).toEqual([]);
    expect(result.filesTouched).toEqual([]);
  });

  it('handles invalid metadata JSON gracefully (defaults to empty)', () => {
    const db = buildDb({ withMetadata: true });
    db.prepare(
      `INSERT INTO observations (id, memory_session_id, project, type, title, concepts,
        files_read, files_modified, prompt_number, created_at, created_at_epoch, metadata)
       VALUES (1, 'mem-1', 'p', 'change', 'bad', '[]', '[]', '[]', 1,
       '2026-06-01T00:00:00Z', 1748736000000, 'not-json')`,
    ).run();
    insertObs(db, { id: 2, session: 'mem-1', title: 'good', ts: 1748775600000,
      metadata: { playbook_id: 'foo' } }, true);

    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    const graph = buildGraph(observations, sessions);

    const result = queryPlaybookLineage(graph, { name: 'foo' });
    expect(result.matchedCount).toBe(1);
    expect(result.runs[0].observations[0].id).toBe(2);
  });

  it('loader works on DBs missing the metadata column (back-compat)', () => {
    const db = buildDb({ withMetadata: false });
    insertObs(db, { id: 1, session: 'mem-1', title: 'old-schema', ts: 1748775600000 }, false);
    const observations = loadObservations(db);
    db.close();
    expect(observations).toHaveLength(1);
    expect(observations[0].metadata).toEqual({});
  });
});
