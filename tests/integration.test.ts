import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import Database from 'better-sqlite3';
import { validateSchemaVersion, loadObservations, loadSessions } from '../src/loader.js';
import { buildGraph } from '../src/graph.js';
import { queryContext, queryTimeline, queryFileImpact, queryStaleness } from '../src/query.js';

const PROD_DB = `${process.env.HOME}/.claude-mem/claude-mem.db`;
const SKIP = !existsSync(PROD_DB);

describe.skipIf(SKIP)('integration: production claude-mem.db', () => {
  let tmpDbPath: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'cmg-integration-'));
    tmpDbPath = join(dir, 'claude-mem.db');
    copyFileSync(PROD_DB, tmpDbPath);
  });

  it('validates schema version', () => {
    const db = new Database(tmpDbPath, { readonly: true });
    expect(() => validateSchemaVersion(db)).not.toThrow();
    db.close();
  });

  it('loads observations and sessions', () => {
    const db = new Database(tmpDbPath, { readonly: true });
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    expect(observations.length).toBeGreaterThan(0);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('builds graph under 500ms', () => {
    const db = new Database(tmpDbPath, { readonly: true });
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();

    const start = performance.now();
    const graph = buildGraph(observations, sessions);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(graph.order).toBeGreaterThan(0);
    expect(graph.size).toBeGreaterThan(0);
  });

  it('queryContext returns results for known project', () => {
    const db = new Database(tmpDbPath, { readonly: true });
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    const graph = buildGraph(observations, sessions);

    const result = queryContext(graph, { project: 'public', sinceDays: 90 });
    expect(result.observations.length).toBeGreaterThan(0);
  });

  it('queryTimeline returns chronological results', () => {
    const db = new Database(tmpDbPath, { readonly: true });
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    const graph = buildGraph(observations, sessions);

    const since = new Date('2026-03-01').getTime();
    const result = queryTimeline(graph, { project: 'public', since });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].session.startedAt).toBeGreaterThanOrEqual(result[i - 1].session.startedAt);
    }
  });

  it('each query completes under 100ms', () => {
    const db = new Database(tmpDbPath, { readonly: true });
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    db.close();
    const graph = buildGraph(observations, sessions);

    const start1 = performance.now();
    queryContext(graph, { project: 'public' });
    expect(performance.now() - start1).toBeLessThan(100);

    const start2 = performance.now();
    queryTimeline(graph, { project: 'public' });
    expect(performance.now() - start2).toBeLessThan(100);

    if (observations.length > 0) {
      const start3 = performance.now();
      queryStaleness(graph, { observationId: observations[0].id });
      expect(performance.now() - start3).toBeLessThan(100);
    }
  });
});
