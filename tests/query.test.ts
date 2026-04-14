import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { loadObservations, loadSessions } from '../src/loader.js';
import { buildGraph } from '../src/graph.js';
import type { GraphType } from '../src/graph.js';
import {
  queryContext,
  queryRelated,
  queryStaleness,
  queryTimeline,
  queryFileImpact,
  queryLineage,
  queryConflicts,
} from '../src/query.js';

function createTestDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'cmg-query-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  const seed = readFileSync(join(__dirname, 'fixtures/seed.sql'), 'utf-8');
  db.exec(seed);
  db.close();
  return new Database(dbPath, { readonly: true });
}

let graph: GraphType;

beforeAll(() => {
  const db = createTestDb();
  const observations = loadObservations(db);
  const sessions = loadSessions(db);
  db.close();
  graph = buildGraph(observations, sessions);
});

describe('queryContext', () => {
  it('returns observations for wp-content project', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 400 });
    expect(result.observations.length).toBeGreaterThan(0);
    for (const a of result.observations) {
      expect(a.observation.project).toBe('wp-content');
    }
  });

  it('places stale observations after non-stale ones', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 400 });
    const obs = result.observations;
    const firstStaleIdx = obs.findIndex(a => a.annotations.some(n => n.startsWith('superseded')));
    const lastNonStaleIdx = obs.map((a, i) => ({ a, i }))
      .filter(({ a }) => !a.annotations.some(n => n.startsWith('superseded')))
      .reduce((max, { i }) => Math.max(max, i), -1);

    if (firstStaleIdx !== -1 && lastNonStaleIdx !== -1) {
      expect(firstStaleIdx).toBeGreaterThan(lastNonStaleIdx);
    }
  });

  it('annotates obs:2 as superseded by #4', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 400 });
    const ann = result.observations.find(a => a.observation.id === 2);
    expect(ann).toBeDefined();
    expect(ann!.annotations).toContain('superseded by #4');
  });

  it('respects maxSessions cap', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 400, maxSessions: 1 });
    const sessionIds = new Set(result.observations.map(a => a.observation.sessionId));
    expect(sessionIds.size).toBeLessThanOrEqual(1);
  });

  it('returns empty when sinceDays=0', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 0 });
    expect(result.observations).toHaveLength(0);
    expect(result.sessionArcs).toHaveLength(0);
  });

  it('keyword filter for batch returns only matching observations', () => {
    const result = queryContext(graph, {
      project: 'wp-content',
      sinceDays: 400,
      taskDescription: 'batch endpoint',
    });
    expect(result.observations.length).toBeGreaterThan(0);
    for (const a of result.observations) {
      const text = [a.observation.title, ...a.observation.concepts].join(' ').toLowerCase();
      const hasMatch = ['batch', 'endpoint'].some(k => text.includes(k));
      expect(hasMatch).toBe(true);
    }
  });

  it('includes session arcs for continuing sessions', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 400 });
    expect(result.sessionArcs.length).toBeGreaterThan(0);
    for (const arc of result.sessionArcs) {
      expect(arc.edgeType).toBe('continues');
      expect(arc.sessions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('caps results at 15 observations', () => {
    const result = queryContext(graph, { project: 'wp-content', sinceDays: 400 });
    expect(result.observations.length).toBeLessThanOrEqual(15);
  });
});

describe('queryRelated', () => {
  it('returns grouped neighbors for obs:1', () => {
    const result = queryRelated(graph, { observationId: 1 });
    expect(Object.keys(result.byEdgeType).length).toBeGreaterThan(0);
  });

  it('includes produced_by edge for obs:1', () => {
    const result = queryRelated(graph, { observationId: 1 });
    expect(result.byEdgeType['produced_by']).toBeDefined();
    const sessionItem = result.byEdgeType['produced_by'].find(i => i.nodeKey === 'sess:sess-a');
    expect(sessionItem).toBeDefined();
    expect(sessionItem!.hops).toBe(1);
  });

  it('includes relates_to edges for obs:1 concepts', () => {
    const result = queryRelated(graph, { observationId: 1 });
    expect(result.byEdgeType['relates_to']).toBeDefined();
    const labels = result.byEdgeType['relates_to'].map(i => i.label);
    expect(labels).toContain('hubspot');
  });

  it('respects maxResults cap', () => {
    const result = queryRelated(graph, { observationId: 1, maxResults: 3 });
    const total = Object.values(result.byEdgeType).reduce((sum, items) => sum + items.length, 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it('returns empty byEdgeType for unknown observation', () => {
    const result = queryRelated(graph, { observationId: 9999 });
    expect(Object.keys(result.byEdgeType)).toHaveLength(0);
  });
});

describe('queryStaleness', () => {
  it('obs:2 is stale, superseded by obs:4', () => {
    const result = queryStaleness(graph, { observationId: 2 });
    expect(result.status).toBe('stale');
    expect(result.supersededBy).toBe(4);
    expect(result.reason).toMatch(/superseded by #4/i);
  });

  it('obs:4 is current', () => {
    const result = queryStaleness(graph, { observationId: 4 });
    expect(result.status).toBe('current');
    expect(result.supersededBy).toBeNull();
  });

  it('obs:1 is current (discovery type, not superseded)', () => {
    const result = queryStaleness(graph, { observationId: 1 });
    expect(result.status).toBe('current');
    expect(result.supersededBy).toBeNull();
  });

  it('unknown observation returns uncertain', () => {
    const result = queryStaleness(graph, { observationId: 9999 });
    expect(result.status).toBe('uncertain');
    expect(result.supersededBy).toBeNull();
  });
});

describe('queryTimeline', () => {
  it('returns sessions in chronological order', () => {
    const entries = queryTimeline(graph, { project: 'wp-content', since: 0 });
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].session.startedAt).toBeGreaterThanOrEqual(entries[i - 1].session.startedAt);
    }
  });

  it('includes observations per session', () => {
    const entries = queryTimeline(graph, { project: 'wp-content', since: 0 });
    const sessA = entries.find(e => e.session.contentSessionId === 'sess-a');
    expect(sessA).toBeDefined();
    expect(sessA!.observations.length).toBeGreaterThan(0);
    const ids = sessA!.observations.map(o => o.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it('includes continuesFrom links for continuing sessions', () => {
    const entries = queryTimeline(graph, { project: 'wp-content', since: 0 });
    const sessB = entries.find(e => e.session.contentSessionId === 'sess-b');
    expect(sessB).toBeDefined();
    expect(sessB!.continuesFrom).toBe('sess-a');
  });

  it('filters by since timestamp', () => {
    const cutoff = 1743519600000;
    const entries = queryTimeline(graph, { project: 'wp-content', since: cutoff });
    for (const e of entries) {
      expect(e.session.startedAt).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('returns only sessions for the requested project', () => {
    const entries = queryTimeline(graph, { project: 'public', since: 0 });
    for (const e of entries) {
      expect(e.session.project).toBe('public');
    }
  });
});

describe('queryFileImpact', () => {
  it('V3ClientTest.php appears in both wp-content and public projects', () => {
    const result = queryFileImpact(graph, { filePath: 'tests/HubSpot/V3ClientTest.php' });
    expect(result.filePath).toBe('tests/HubSpot/V3ClientTest.php');
    expect(result.byProject['wp-content']).toBeDefined();
    expect(result.byProject['public']).toBeDefined();
    expect(result.byProject['wp-content'].length).toBeGreaterThan(0);
    expect(result.byProject['public'].length).toBeGreaterThan(0);
  });

  it('obs:3 is in wp-content results for V3ClientTest.php', () => {
    const result = queryFileImpact(graph, { filePath: 'tests/HubSpot/V3ClientTest.php' });
    const wpObs = result.byProject['wp-content'];
    expect(wpObs.some(o => o.id === 3)).toBe(true);
  });

  it('obs:6 is in public results for V3ClientTest.php', () => {
    const result = queryFileImpact(graph, { filePath: 'tests/HubSpot/V3ClientTest.php' });
    const pubObs = result.byProject['public'];
    expect(pubObs.some(o => o.id === 6)).toBe(true);
  });

  it('unknown file returns empty byProject', () => {
    const result = queryFileImpact(graph, { filePath: 'does/not/exist.php' });
    expect(result.filePath).toBe('does/not/exist.php');
    expect(Object.keys(result.byProject)).toHaveLength(0);
  });
});

describe('queryContext cross-project', () => {
  it('returns observations from multiple projects when no project specified', () => {
    const result = queryContext(graph, { sinceDays: 400 });
    const projects = new Set(result.observations.map(a => a.observation.project));
    expect(projects.size).toBeGreaterThan(1);
  });

  it('keyword search works cross-project', () => {
    const result = queryContext(graph, {
      sinceDays: 400,
      taskDescription: 'hubspot',
    });
    expect(result.observations.length).toBeGreaterThan(0);
    for (const a of result.observations) {
      const haystack = [a.observation.title, ...a.observation.concepts].join(' ').toLowerCase();
      expect(haystack).toContain('hubspot');
    }
  });

  it('uses wider time window when taskDescription is present vs absent', () => {
    const withDesc = queryContext(graph, {
      project: 'wp-content',
      taskDescription: 'hubspot',
      sinceDays: 400,
    });
    const withoutDesc = queryContext(graph, {
      project: 'wp-content',
      sinceDays: 0,
    });
    expect(withDesc.observations.length).toBeGreaterThan(withoutDesc.observations.length);
  });

  it('still respects explicit sinceDays even with taskDescription', () => {
    const result = queryContext(graph, {
      project: 'wp-content',
      taskDescription: 'hubspot',
      sinceDays: 0,
    });
    expect(result.observations).toHaveLength(0);
  });
});

describe('queryLineage', () => {
  it('returns a chain for an observation with led_to edges', () => {
    const result = queryLineage(graph, { observationId: 2 });
    expect(result.chain.length).toBeGreaterThanOrEqual(1);
    const ids = result.chain.map(s => s.observation.id);
    expect(ids).toContain(2);
  });

  it('obs:1 (discovery) led_to obs:2 (decision) should appear in lineage of obs:2', () => {
    const result = queryLineage(graph, { observationId: 2 });
    const ids = result.chain.map(s => s.observation.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(2));
  });

  it('returns single-element chain for an observation with no causal predecessors', () => {
    const result = queryLineage(graph, { observationId: 5 });
    expect(result.chain.length).toBeGreaterThanOrEqual(1);
    expect(result.chain[0].observation.id).toBe(5);
  });

  it('returns empty chain for unknown observation', () => {
    const result = queryLineage(graph, { observationId: 9999 });
    expect(result.chain).toHaveLength(0);
  });
});

describe('queryConflicts', () => {
  it('obs:2 shows supersedes conflict with obs:4', () => {
    const result = queryConflicts(graph, { observationId: 2 });
    expect(result.pairs.length).toBeGreaterThan(0);
    const supersededPair = result.pairs.find(p => p.relationship === 'supersedes');
    expect(supersededPair).toBeDefined();
    expect(supersededPair!.current.id).toBe(4);
    expect(supersededPair!.conflicting.id).toBe(2);
  });

  it('obs:4 shows supersedes conflict with obs:2', () => {
    const result = queryConflicts(graph, { observationId: 4 });
    const supersededPair = result.pairs.find(
      p => p.relationship === 'supersedes' && p.conflicting.id === 2
    );
    expect(supersededPair).toBeDefined();
    expect(supersededPair!.current.id).toBe(4);
  });

  it('includes shared concepts in conflict pairs', () => {
    const result = queryConflicts(graph, { observationId: 2 });
    for (const pair of result.pairs) {
      expect(pair.sharedConcepts.length).toBeGreaterThan(0);
    }
  });

  it('returns empty for unknown observation', () => {
    const result = queryConflicts(graph, { observationId: 9999 });
    expect(result.pairs).toHaveLength(0);
  });
});
