import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { openDatabase } from './loader.js';
import { loadObservations, loadSessions } from './loader.js';
import { buildGraph } from './graph.js';
import type { GraphType } from './graph.js';
import {
  queryContext,
  queryRelated,
  queryStaleness,
  queryTimeline,
  queryFileImpact,
  queryLineage,
  queryConflicts,
} from './query.js';
import type {
  AnnotatedObservation,
  SessionArc,
  RelatedItem,
  TimelineEntry,
  FileImpactResult,
  LineageStep,
  ConflictPair,
} from './types.js';

let graph: GraphType;

const LOG_DIR = join(process.env.HOME ?? '', '.claude-mem-graph');
const LOG_FILE = join(LOG_DIR, 'usage.jsonl');

function logUsage(tool: string, params: Record<string, unknown>, resultCount: number): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      params,
      resultCount,
    });
    appendFileSync(LOG_FILE, entry + '\n');
  } catch {
    // non-fatal
  }
}

function initGraph(): void {
  const db = openDatabase();
  const observations = loadObservations(db);
  const sessions = loadSessions(db);
  graph = buildGraph(observations, sessions);
  const nodeCount = graph.order;
  const edgeCount = graph.size;
  process.stderr.write(
    `[claude-mem-graph] loaded: ${observations.length} observations, ${sessions.length} sessions → ${nodeCount} nodes, ${edgeCount} edges\n`
  );
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function formatContextResult(
  observations: AnnotatedObservation[],
  sessionArcs: SessionArc[],
): string {
  const lines: string[] = [];

  if (sessionArcs.length > 0) {
    lines.push('## Session Arcs');
    for (const arc of sessionArcs) {
      const ids = arc.sessions.map(s => s.contentSessionId.slice(0, 8)).join(' → ');
      const projects = [...new Set(arc.sessions.map(s => s.project))].join(', ');
      lines.push(`- [${projects}] ${ids} (${arc.sessions.length} sessions)`);
    }
    lines.push('');
  }

  lines.push('## Observations');
  if (observations.length === 0) {
    lines.push('No matching observations found.');
  } else {
    for (const { observation: obs, score, annotations } of observations) {
      const ann = annotations.length > 0 ? ` ⚠ ${annotations.join(', ')}` : '';
      lines.push(`### #${obs.id} — ${obs.title}${ann}`);
      lines.push(`- Project: ${obs.project}  Score: ${score.toFixed(3)}  Type: ${obs.type}`);
      lines.push(`- Date: ${formatDate(obs.createdAt)}`);
      if (obs.concepts.length > 0) {
        lines.push(`- Concepts: ${obs.concepts.join(', ')}`);
      }
      if (obs.filesModified.length > 0) {
        lines.push(`- Files modified: ${obs.filesModified.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatRelatedResult(byEdgeType: Record<string, RelatedItem[]>): string {
  const lines: string[] = [];
  const types = Object.keys(byEdgeType);

  if (types.length === 0) {
    return 'No related nodes found.';
  }

  for (const edgeType of types) {
    lines.push(`## ${edgeType}`);
    for (const item of byEdgeType[edgeType]) {
      lines.push(`- [hop ${item.hops}] ${item.nodeType}:${item.nodeKey} — ${item.label}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatStalenessResult(
  status: string,
  supersededBy: number | null,
  reason: string,
): string {
  const lines: string[] = [];
  const statusIcon = status === 'current' ? '✓' : status === 'stale' ? '✗' : '?';
  lines.push(`Status: ${statusIcon} ${status.toUpperCase()}`);
  if (supersededBy != null) {
    lines.push(`Superseded by: #${supersededBy}`);
  }
  lines.push(`Reason: ${reason}`);
  return lines.join('\n');
}

function formatTimelineResult(entries: TimelineEntry[]): string {
  const lines: string[] = [];

  if (entries.length === 0) {
    return 'No sessions found for this project in the given time range.';
  }

  for (const entry of entries) {
    const { session, observations, continuesFrom } = entry;
    const date = formatDate(session.startedAt);
    const sessId = session.contentSessionId.slice(0, 8);
    lines.push(`## ${date} — session ${sessId} [${session.status}]`);
    if (continuesFrom) {
      lines.push(`- Continues from: ${continuesFrom.slice(0, 8)}`);
    }
    if (observations.length === 0) {
      lines.push('- No observations');
    } else {
      for (const obs of observations) {
        lines.push(`- #${obs.id} ${obs.type}: ${obs.title}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatFileImpactResult(result: FileImpactResult): string {
  const lines: string[] = [];
  lines.push(`## File: ${result.filePath}`);
  lines.push('');

  const projects = Object.keys(result.byProject);
  if (projects.length === 0) {
    lines.push('No observations reference this file.');
    return lines.join('\n');
  }

  for (const project of projects) {
    lines.push(`### ${project}`);
    for (const obs of result.byProject[project]) {
      lines.push(`- #${obs.id} [${obs.type}] ${obs.title} (${formatDate(obs.createdAt)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatLineageResult(chain: LineageStep[], rootId: number): string {
  if (chain.length === 0) {
    return `No lineage found for observation #${rootId}.`;
  }

  const lines: string[] = [];
  lines.push(`## Causal Chain (root: #${rootId})`);
  lines.push('');

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const obs = step.observation;
    const prefix = i === 0 ? '🔵' : '→';
    const edgeLabel = step.direction === 'root' ? '(root)' : `via ${step.edgeType}`;
    lines.push(`${prefix} **#${obs.id}** ${obs.title} ${edgeLabel}`);
    lines.push(`  - Project: ${obs.project}  Type: ${obs.type}  Date: ${formatDate(obs.createdAt)}`);
    if (obs.concepts.length > 0) {
      lines.push(`  - Concepts: ${obs.concepts.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function formatConflictsResult(pairs: ConflictPair[]): string {
  if (pairs.length === 0) {
    return 'No conflicts detected.';
  }

  const lines: string[] = [];
  lines.push(`## Conflicts Found: ${pairs.length}`);
  lines.push('');

  for (const pair of pairs) {
    lines.push(`### ${pair.relationship === 'supersedes' ? 'Supersedes' : 'Concept Overlap'}`);
    lines.push(`- **Current:** #${pair.current.id} — ${pair.current.title} (${formatDate(pair.current.createdAt)})`);
    lines.push(`- **Conflicting:** #${pair.conflicting.id} — ${pair.conflicting.title} (${formatDate(pair.conflicting.createdAt)})`);
    lines.push(`- **Shared concepts:** ${pair.sharedConcepts.join(', ')}`);
    lines.push(`- **Resolution:** #${pair.current.id} is newer and should be treated as authoritative`);
    lines.push('');
  }

  return lines.join('\n');
}

try {
  initGraph();
} catch (err) {
  process.stderr.write(`[claude-mem-graph] startup failed: ${(err as Error).message}\n`);
  process.exit(1);
}

const server = new McpServer({ name: 'claude-mem-graph', version: '0.1.0' });

server.tool(
  'graph_context',
  'Retrieve recent context scored by recency and relevance. Optionally scope to a project or search cross-project. When task_description is provided, defaults to 365 days lookback.',
  {
    project: z.string().optional().describe('Project name to scope results. Omit to search all projects.'),
    task_description: z.string().optional().describe('Optional task description to filter observations by keyword'),
    max_sessions: z.number().optional().describe('Maximum number of recent sessions to include (default 10)'),
    since_days: z.number().optional().describe('How many days back to look (default 90, or 365 when task_description is set)'),
  },
  async ({ project, task_description, max_sessions, since_days }) => {
    const result = queryContext(graph, {
      project,
      taskDescription: task_description,
      maxSessions: max_sessions ?? 10,
      sinceDays: since_days,
    });
    logUsage('graph_context', { project, task_description, max_sessions, since_days }, result.observations.length);
    const text = formatContextResult(result.observations, result.sessionArcs);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_related',
  'Find nodes related to a given observation by traversing up to 2 hops in the graph.',
  {
    observation_id: z.number().describe('ID of the observation to find related nodes for'),
    max_results: z.number().optional().describe('Maximum number of results to return (default 20)'),
  },
  async ({ observation_id, max_results }) => {
    const result = queryRelated(graph, {
      observationId: observation_id,
      maxResults: max_results ?? 20,
    });
    logUsage('graph_related', { observation_id, max_results }, Object.values(result.byEdgeType).flat().length);
    const text = formatRelatedResult(result.byEdgeType);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_staleness',
  'Check whether an observation has been superseded by a newer one.',
  {
    observation_id: z.number().describe('ID of the observation to check'),
  },
  async ({ observation_id }) => {
    const result = queryStaleness(graph, { observationId: observation_id });
    logUsage('graph_staleness', { observation_id }, result.status === 'stale' ? 1 : 0);
    const text = formatStalenessResult(result.status, result.supersededBy, result.reason);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_timeline',
  'List sessions for a project in chronological order, with their observations.',
  {
    project: z.string().describe('Project name to query'),
    since: z.string().optional().describe('ISO date string (YYYY-MM-DD) to start from'),
  },
  async ({ project, since }) => {
    const sinceMs = since ? new Date(since).getTime() : undefined;
    const entries = queryTimeline(graph, { project, since: sinceMs });
    logUsage('graph_timeline', { project, since }, entries.length);
    const text = formatTimelineResult(entries);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_file_impact',
  'Find all observations that reference a given file path, grouped by project.',
  {
    file_path: z.string().describe('File path to look up (relative or absolute)'),
  },
  async ({ file_path }) => {
    const result = queryFileImpact(graph, { filePath: file_path });
    logUsage('graph_file_impact', { file_path }, Object.values(result.byProject).flat().length);
    const text = formatFileImpactResult(result);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_lineage',
  'Walk backward through causal edges (led_to, depends_on, supersedes) to build a reasoning chain for an observation.',
  {
    observation_id: z.number().describe('ID of the observation to trace lineage for'),
    max_depth: z.number().optional().describe('Maximum chain depth (default 20)'),
  },
  async ({ observation_id, max_depth }) => {
    const result = queryLineage(graph, {
      observationId: observation_id,
      maxDepth: max_depth ?? 20,
    });
    logUsage('graph_lineage', { observation_id, max_depth }, result.chain.length);
    const text = formatLineageResult(result.chain, result.rootId);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_conflicts',
  'Find observations that conflict with or supersede a given observation. Detects supersedes edges and concept-overlap conflicts.',
  {
    observation_id: z.number().describe('ID of the observation to find conflicts for'),
  },
  async ({ observation_id }) => {
    const result = queryConflicts(graph, { observationId: observation_id });
    logUsage('graph_conflicts', { observation_id }, result.pairs.length);
    const text = formatConflictsResult(result.pairs);
    return { content: [{ type: 'text' as const, text }] };
  }
);

server.tool(
  'graph_rebuild',
  'Reload the database and rebuild the graph from scratch.',
  {},
  async () => {
    const start = Date.now();
    const db = openDatabase();
    const observations = loadObservations(db);
    const sessions = loadSessions(db);
    graph = buildGraph(observations, sessions);
    const buildTimeMs = Date.now() - start;
    const nodeCount = graph.order;
    const edgeCount = graph.size;
    logUsage('graph_rebuild', {}, nodeCount);
    const text = `Rebuilt: ${nodeCount} nodes, ${edgeCount} edges in ${buildTimeMs}ms`;
    return { content: [{ type: 'text' as const, text }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err: Error) => {
  process.stderr.write(`[claude-mem-graph] connection error: ${err.message}\n`);
  process.exit(1);
});
