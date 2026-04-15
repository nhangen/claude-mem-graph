import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { loadObservations, loadSessions, validateSchemaVersion } from '../src/loader.js';

function createTestDb(): { db: Database.Database; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cmg-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  const seed = readFileSync(join(__dirname, 'fixtures/seed.sql'), 'utf-8');
  db.exec(seed);
  db.close();
  return { db: new Database(dbPath, { readonly: true }), path: dbPath };
}

describe('validateSchemaVersion', () => {
  it('passes for supported schema versions', () => {
    const { db } = createTestDb();
    expect(() => validateSchemaVersion(db)).not.toThrow();
    db.close();
  });

  it('throws for unsupported schema version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmg-test-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_versions (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO schema_versions (version, created_at) VALUES (99, '2026-01-01T00:00:00Z');
    `);
    db.close();
    const readDb = new Database(dbPath, { readonly: true });
    expect(() => validateSchemaVersion(readDb)).toThrow(/schema version 99/i);
    readDb.close();
  });

  it('throws when schema_versions table is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmg-test-'));
    const dbPath = join(dir, 'test.db');
    new Database(dbPath).close();
    const readDb = new Database(dbPath, { readonly: true });
    expect(() => validateSchemaVersion(readDb)).toThrow();
    readDb.close();
  });
});

describe('loadObservations', () => {
  it('loads and parses all observations with JSON fields', () => {
    const { db } = createTestDb();
    const observations = loadObservations(db);
    expect(observations).toHaveLength(8);
    const obs1 = observations.find(o => o.id === 1)!;
    expect(obs1.title).toBe('HubSpot v1 API deprecated');
    expect(obs1.type).toBe('discovery');
    expect(obs1.project).toBe('wp-content');
    expect(obs1.concepts).toEqual(['hubspot', 'api-migration', 'contact-lists']);
    expect(obs1.filesRead).toEqual(['src/HubSpot/Client.php']);
    expect(obs1.filesModified).toEqual([]);
    expect(obs1.relevanceCount).toBe(5);
    db.close();
  });

  it('handles null JSON fields gracefully', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmg-test-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_versions (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO schema_versions (version, created_at) VALUES (26, '2026-01-01T00:00:00Z');
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, text TEXT, type TEXT,
        title TEXT, subtitle TEXT, facts TEXT, narrative TEXT, concepts TEXT,
        files_read TEXT, files_modified TEXT, prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0, created_at TEXT, created_at_epoch INTEGER,
        content_hash TEXT, generated_by_model TEXT, relevance_count INTEGER DEFAULT 0
      );
      INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch)
      VALUES (1, 'mem-x', 'test', 'discovery', 'Null fields test', NULL, NULL, NULL, 1, '2026-01-01T00:00:00Z', 1735689600000);
    `);
    db.close();
    const readDb = new Database(dbPath, { readonly: true });
    const observations = loadObservations(readDb);
    expect(observations[0].concepts).toEqual([]);
    expect(observations[0].filesRead).toEqual([]);
    expect(observations[0].filesModified).toEqual([]);
    readDb.close();
  });
});

describe('loadSessions', () => {
  it('loads all sessions with correct fields', () => {
    const { db } = createTestDb();
    const sessions = loadSessions(db);
    expect(sessions).toHaveLength(4);
    const sessA = sessions.find(s => s.contentSessionId === 'sess-a')!;
    expect(sessA.project).toBe('wp-content');
    expect(sessA.status).toBe('completed');
    expect(sessA.memorySessionId).toBe('mem-a');
    db.close();
  });
});
