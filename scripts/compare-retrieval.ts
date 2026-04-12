import Database from 'better-sqlite3';
import { openDatabase, loadObservations, loadSessions } from '../src/loader.js';
import { buildGraph } from '../src/graph.js';
import { queryContext, queryStaleness } from '../src/query.js';
import type { AnnotatedObservation } from '../src/types.js';
import { DEFAULT_DB_PATH } from '../src/types.js';

const [,, projectArg, searchArg] = process.argv;

if (!projectArg) {
  console.error('Usage: tsx scripts/compare-retrieval.ts <project> [search-term]');
  process.exit(1);
}

const project = projectArg;
const searchTerm = searchArg ?? '';

const db = openDatabase();
const observations = loadObservations(db);
const sessions = loadSessions(db);
db.close();

const graph = buildGraph(observations, sessions);

const ctxResult = queryContext(graph, {
  project,
  taskDescription: searchTerm || undefined,
  maxSessions: 20,
  sinceDays: 90,
});

const graphIds = new Set(ctxResult.observations.map(a => a.observation.id));
const graphById = new Map(ctxResult.observations.map(a => [a.observation.id, a]));

interface FtsRow {
  rowid: number;
  rank: number;
  id: number;
  title: string | null;
  type: string;
  project: string;
  concepts: string | null;
}

let ftsIds = new Set<number>();
const ftsById = new Map<number, FtsRow>();

if (searchTerm) {
  const rawDb = new Database(DEFAULT_DB_PATH, { readonly: true });
  try {
    const rows = rawDb.prepare(`
      SELECT f.rowid, f.rank, o.id, o.title, o.type, o.project, o.concepts
      FROM observations_fts f
      JOIN observations o ON o.rowid = f.rowid
      WHERE observations_fts MATCH ?
        AND o.project = ?
      ORDER BY f.rank
      LIMIT 15
    `).all(searchTerm, project) as FtsRow[];

    for (const row of rows) {
      ftsIds.add(row.id);
      ftsById.set(row.id, row);
    }
  } finally {
    rawDb.close();
  }
}

function formatAnnotations(item: AnnotatedObservation): string {
  return item.annotations.length ? ` [${item.annotations.join(', ')}]` : '';
}

function formatConcepts(raw: string | null): string {
  if (!raw) return '';
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.join(', ') : '';
  } catch {
    return '';
  }
}

const graphOnlyIds = [...graphIds].filter(id => !ftsIds.has(id));
const ftsOnlyIds = [...ftsIds].filter(id => !graphIds.has(id));
const bothIds = [...graphIds].filter(id => ftsIds.has(id));

console.log(`\nProject: ${project}${searchTerm ? `  |  Query: "${searchTerm}"` : ''}`);
console.log(`Graph results: ${graphIds.size}   FTS results: ${ftsIds.size}\n`);

console.log('=== GRAPH ONLY ===');
if (graphOnlyIds.length === 0) {
  console.log('  (none)');
} else {
  for (const id of graphOnlyIds) {
    const item = graphById.get(id)!;
    const ann = formatAnnotations(item);
    console.log(`  #${id} (${item.observation.type}) ${item.observation.title}${ann}`);
    console.log(`    score: ${item.score.toFixed(3)} | concepts: ${item.observation.concepts.join(', ')}`);
  }
}

console.log('\n=== FTS ONLY ===');
if (ftsOnlyIds.length === 0) {
  console.log('  (none)');
} else {
  for (const id of ftsOnlyIds) {
    const row = ftsById.get(id)!;
    console.log(`  #${id} (${row.type}) ${row.title ?? '(no title)'}`);
    console.log(`    fts rank: ${row.rank.toFixed(4)} | concepts: ${formatConcepts(row.concepts)}`);
  }
}

console.log('\n=== BOTH ===');
if (bothIds.length === 0) {
  console.log('  (none)');
} else {
  for (const id of bothIds) {
    const item = graphById.get(id)!;
    const row = ftsById.get(id)!;
    const ann = formatAnnotations(item);
    console.log(`  #${id} (${item.observation.type}) ${item.observation.title}${ann}`);
    console.log(`    score: ${item.score.toFixed(3)} | fts rank: ${row.rank.toFixed(4)} | concepts: ${item.observation.concepts.join(', ')}`);
  }
}

console.log('\n=== STALENESS SUMMARY ===');
const decisions = observations.filter(o => o.type === 'decision' && o.project === project);
let staleCount = 0;
for (const d of decisions) {
  const result = queryStaleness(graph, { observationId: d.id });
  if (result.status === 'stale') {
    staleCount++;
    console.log(`  STALE #${d.id} "${d.title}" → superseded by #${result.supersededBy}`);
  }
}
console.log(`${staleCount} of ${decisions.length} decisions are stale in project "${project}"`);
