#!/usr/bin/env tsx
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join(process.env.HOME ?? '', '.claude-mem-graph', 'usage.jsonl');

if (!existsSync(LOG_FILE)) {
  console.log('No usage data yet. Use the plugin first.');
  process.exit(0);
}

interface LogEntry {
  ts: string;
  sessionId?: string;
  cwd?: string;
  tool: string;
  params: Record<string, unknown>;
  resultCount: number;
}

const lines = readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
const entries: LogEntry[] = lines.map(l => JSON.parse(l));

const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;

// --- Overview ---
console.log('═══════════════════════════════════════════════');
console.log(' claude-mem-graph — Usage Analytics');
console.log('═══════════════════════════════════════════════');
console.log(`  Total calls: ${entries.length}`);
console.log(`  Date range: ${entries[0]?.ts.slice(0, 10)} → ${entries[entries.length - 1]?.ts.slice(0, 10)}`);

const sessions = new Set(entries.map(e => e.sessionId).filter(Boolean));
console.log(`  Distinct sessions: ${sessions.size || '(no session IDs — pre-telemetry data)'}`);

const cwds = new Set(entries.map(e => e.cwd).filter(Boolean));
if (cwds.size > 0) {
  console.log(`  Distinct workspaces: ${cwds.size}`);
}

// --- By Tool ---
console.log('\n── Calls by Tool ──');
const byTool = new Map<string, { count: number; totalResults: number; emptyCount: number }>();
for (const e of entries) {
  const t = byTool.get(e.tool) ?? { count: 0, totalResults: 0, emptyCount: 0 };
  t.count++;
  t.totalResults += e.resultCount;
  if (e.resultCount === 0) t.emptyCount++;
  byTool.set(e.tool, t);
}

const toolRows = [...byTool.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`${'Tool'.padEnd(20)} ${'Calls'.padStart(6)} ${'Avg Results'.padStart(12)} ${'Empty %'.padStart(9)}`);
console.log('─'.repeat(50));
for (const [tool, stats] of toolRows) {
  const avg = stats.count > 0 ? (stats.totalResults / stats.count).toFixed(1) : '0';
  const emptyPct = stats.count > 0 ? ((stats.emptyCount / stats.count) * 100).toFixed(0) + '%' : '0%';
  console.log(`${tool.padEnd(20)} ${String(stats.count).padStart(6)} ${avg.padStart(12)} ${emptyPct.padStart(9)}`);
}

// --- By Day ---
console.log('\n── Calls by Day ──');
const byDay = new Map<string, number>();
for (const e of entries) {
  const day = e.ts.slice(0, 10);
  byDay.set(day, (byDay.get(day) ?? 0) + 1);
}
for (const [day, count] of [...byDay.entries()].sort()) {
  const bar = '█'.repeat(Math.min(count, 40));
  console.log(`${day}  ${bar} ${count}`);
}

// --- Query Patterns ---
console.log('\n── Top Search Queries ──');
const queries = entries
  .filter(e => (e.tool === 'graph_search' || e.tool === 'graph_context') && e.params.task_description)
  .map(e => ({ query: String(e.params.task_description), results: e.resultCount }));

const queryFreq = new Map<string, { count: number; avgResults: number }>();
for (const q of queries) {
  const key = q.query.toLowerCase();
  const prev = queryFreq.get(key) ?? { count: 0, avgResults: 0 };
  prev.avgResults = (prev.avgResults * prev.count + q.results) / (prev.count + 1);
  prev.count++;
  queryFreq.set(key, prev);
}

const topQueries = [...queryFreq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
for (const [query, stats] of topQueries) {
  console.log(`  "${query}" — ${stats.count}x, avg ${stats.avgResults.toFixed(0)} results`);
}
if (topQueries.length === 0) console.log('  (no keyword searches yet)');

// --- Project Distribution ---
console.log('\n── Projects Queried ──');
const projects = new Map<string, number>();
for (const e of entries) {
  const p = e.params.project as string | undefined;
  if (p) projects.set(p, (projects.get(p) ?? 0) + 1);
}
const noneCount = entries.filter(e => !e.params.project).length;
if (noneCount > 0) projects.set('(cross-project)', noneCount);

for (const [proj, count] of [...projects.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${proj}: ${count}`);
}

// --- Workflow Patterns ---
console.log('\n── Workflow Patterns ──');
const sessionEntries = new Map<string, LogEntry[]>();
for (const e of entries) {
  const sid = e.sessionId ?? 'unknown';
  const list = sessionEntries.get(sid) ?? [];
  list.push(e);
  sessionEntries.set(sid, list);
}

let searchThenNeighbors = 0;
let neighborsOnly = 0;
let searchOnly = 0;
let timelineOnly = 0;
let fileHistoryOnly = 0;

for (const [, sessEntries] of sessionEntries) {
  const tools = sessEntries.map(e => e.tool);
  const hasSearch = tools.includes('graph_search') || tools.includes('graph_context');
  const hasNeighbors = tools.includes('graph_neighbors') || tools.includes('graph_related');
  const hasTimeline = tools.includes('graph_timeline');
  const hasFileHistory = tools.includes('graph_file_history') || tools.includes('graph_file_impact');

  if (hasSearch && hasNeighbors) searchThenNeighbors++;
  else if (hasSearch && !hasNeighbors) searchOnly++;
  else if (!hasSearch && hasNeighbors) neighborsOnly++;
  if (hasTimeline && !hasSearch && !hasNeighbors) timelineOnly++;
  if (hasFileHistory && !hasSearch && !hasNeighbors) fileHistoryOnly++;
}

console.log(`  Search → Neighbors (intended workflow): ${searchThenNeighbors}`);
console.log(`  Search only (no follow-up tracing): ${searchOnly}`);
console.log(`  Neighbors only (already had an ID): ${neighborsOnly}`);
console.log(`  Timeline only: ${timelineOnly}`);
console.log(`  File history only: ${fileHistoryOnly}`);

// --- Empty Result Analysis ---
console.log('\n── Empty Result Calls ──');
const emptyResults = entries.filter(e => e.resultCount === 0);
console.log(`  ${emptyResults.length} of ${entries.length} calls returned 0 results (${((emptyResults.length / entries.length) * 100).toFixed(0)}%)`);
if (emptyResults.length > 0) {
  const emptyByTool = new Map<string, number>();
  for (const e of emptyResults) {
    emptyByTool.set(e.tool, (emptyByTool.get(e.tool) ?? 0) + 1);
  }
  for (const [tool, count] of [...emptyByTool.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tool}: ${count} empty`);
  }
}

// --- Observation IDs Traced ---
console.log('\n── Most Traced Observations ──');
const obsTraced = new Map<number, number>();
for (const e of entries) {
  const obsId = e.params.observation_id as number | undefined;
  if (obsId) obsTraced.set(obsId, (obsTraced.get(obsId) ?? 0) + 1);
}
const topObs = [...obsTraced.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [obsId, count] of topObs) {
  console.log(`  #${obsId}: traced ${count}x`);
}
if (topObs.length === 0) console.log('  (no observation tracing yet)');
