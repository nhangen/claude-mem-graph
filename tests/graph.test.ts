import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { loadObservations, loadSessions } from '../src/loader.js';
import { buildGraph } from '../src/graph.js';
import type { GraphType } from '../src/graph.js';
import type { Observation, Session } from '../src/types.js';

function createTestDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'cmg-graph-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  const seed = readFileSync(join(__dirname, 'fixtures/seed.sql'), 'utf-8');
  db.exec(seed);
  db.close();
  return new Database(dbPath, { readonly: true });
}

function loadFixtures(): { observations: Observation[]; sessions: Session[]; graph: GraphType } {
  const db = createTestDb();
  const observations = loadObservations(db);
  const sessions = loadSessions(db);
  db.close();
  const graph = buildGraph(observations, sessions);
  return { observations, sessions, graph };
}

let graph: GraphType;
let observations: Observation[];
let sessions: Session[];

beforeAll(() => {
  const fixtures = loadFixtures();
  graph = fixtures.graph;
  observations = fixtures.observations;
  sessions = fixtures.sessions;
});

describe('nodes', () => {
  it('creates observation nodes for all 7 observations', () => {
    for (let i = 1; i <= 7; i++) {
      expect(graph.hasNode(`obs:${i}`)).toBe(true);
    }
  });

  it('creates session nodes for all 4 sessions', () => {
    for (const sid of ['sess-a', 'sess-b', 'sess-c', 'sess-d']) {
      expect(graph.hasNode(`sess:${sid}`)).toBe(true);
    }
  });

  it('creates project nodes for wp-content and public', () => {
    expect(graph.hasNode('proj:wp-content')).toBe(true);
    expect(graph.hasNode('proj:public')).toBe(true);
  });

  it('creates concept nodes extracted from observations', () => {
    for (const concept of ['hubspot', 'api-migration', 'contact-lists', 'token-scope', 'cache']) {
      expect(graph.hasNode(`concept:${concept}`)).toBe(true);
    }
  });

  it('creates file nodes from filesRead and filesModified', () => {
    expect(graph.hasNode('file:src/HubSpot/Client.php')).toBe(true);
    expect(graph.hasNode('file:src/HubSpot/V3Client.php')).toBe(true);
  });
});

describe('produced_by edges', () => {
  it('obs:1 produced_by sess:sess-a', () => {
    const edges = graph.filterOutEdges('obs:1', (_e, attrs) => attrs.type === 'produced_by');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('sess:sess-a');
  });

  it('each observation has exactly one produced_by edge', () => {
    for (let i = 1; i <= 7; i++) {
      const edges = graph.filterOutEdges(`obs:${i}`, (_e, attrs) => attrs.type === 'produced_by');
      expect(edges).toHaveLength(1);
    }
  });
});

describe('led_to edges', () => {
  it('obs:1 (discovery) led_to obs:2 (decision) in same session', () => {
    const edges = graph.filterOutEdges('obs:1', (_e, attrs) => attrs.type === 'led_to');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('obs:2');
  });

  it('does not create led_to edge between observations in different sessions', () => {
    const edgesFrom2 = graph.filterOutEdges('obs:2', (_e, attrs) => attrs.type === 'led_to');
    const targets = edgesFrom2.map(e => graph.target(e));
    expect(targets).not.toContain('obs:3');
  });
});

describe('supersedes edges', () => {
  it('obs:4 supersedes obs:2 (same project, >=50% concept overlap, newer, both decisions)', () => {
    const edges = graph.filterOutEdges('obs:4', (_e, attrs) => attrs.type === 'supersedes');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('obs:2');
  });

  it('does not infer supersedes for feature type (obs:3 is feature)', () => {
    const edges = graph.filterOutEdges('obs:3', (_e, attrs) => attrs.type === 'supersedes');
    expect(edges).toHaveLength(0);
  });
});

describe('relates_to edges', () => {
  it('obs:1 relates_to hubspot, api-migration, and contact-lists concepts', () => {
    const edges = graph.filterOutEdges('obs:1', (_e, attrs) => attrs.type === 'relates_to');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('concept:hubspot');
    expect(targets).toContain('concept:api-migration');
    expect(targets).toContain('concept:contact-lists');
  });
});

describe('touches edges', () => {
  it('obs:2 touches src/HubSpot/Client.php and src/HubSpot/V3Client.php', () => {
    const edges = graph.filterOutEdges('obs:2', (_e, attrs) => attrs.type === 'touches');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('file:src/HubSpot/Client.php');
    expect(targets).toContain('file:src/HubSpot/V3Client.php');
  });
});

describe('part_of edges', () => {
  it('sess:sess-a part_of proj:wp-content', () => {
    const edges = graph.filterOutEdges('sess:sess-a', (_e, attrs) => attrs.type === 'part_of');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('proj:wp-content');
  });

  it('sess:sess-c part_of proj:public', () => {
    const edges = graph.filterOutEdges('sess:sess-c', (_e, attrs) => attrs.type === 'part_of');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('proj:public');
  });
});

describe('co_occurs edges', () => {
  it('concept:hubspot co_occurs with concept:api-migration with weight >= 3', () => {
    const allEdges = graph.filterEdges(
      'concept:hubspot',
      (_e, attrs) => attrs.type === 'co_occurs',
    );
    const apiMigrationEdge = allEdges.find(e => {
      const src = graph.source(e);
      const tgt = graph.target(e);
      return (src === 'concept:hubspot' && tgt === 'concept:api-migration') ||
        (src === 'concept:api-migration' && tgt === 'concept:hubspot');
    });
    expect(apiMigrationEdge).toBeDefined();
    const weight = graph.getEdgeAttribute(apiMigrationEdge!, 'weight') as number;
    expect(weight).toBeGreaterThanOrEqual(3);
  });
});

describe('depends_on edges', () => {
  it('obs:3 depends_on obs:2 (obs:2 modified V3Client.php, obs:3 read it later)', () => {
    const edges = graph.filterOutEdges('obs:3', (_e, attrs) => attrs.type === 'depends_on');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('obs:2');
  });
});

describe('continues edges', () => {
  it('sess:sess-b continues sess:sess-a (same project, overlapping files, within 24h)', () => {
    const edges = graph.filterOutEdges('sess:sess-b', (_e, attrs) => attrs.type === 'continues');
    const targets = edges.map(e => graph.target(e));
    expect(targets).toContain('sess:sess-a');
  });

  it('sess:sess-d does NOT continue sess:sess-b (gap > 24h)', () => {
    const edges = graph.filterOutEdges('sess:sess-d', (_e, attrs) => attrs.type === 'continues');
    const targets = edges.map(e => graph.target(e));
    expect(targets).not.toContain('sess:sess-b');
  });
});
