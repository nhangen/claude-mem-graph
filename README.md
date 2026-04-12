# claude-mem-graph

Graph-aware context retrieval layer over [claude-mem](https://github.com/thedotmack/claude-mem). Reads claude-mem's SQLite database, builds an in-memory knowledge graph, and exposes MCP tools for relationship-aware queries.

## Why

claude-mem stores observations as flat rows with keyword/vector search. This plugin adds structural understanding: which observations led to which decisions, which decisions have been superseded, which sessions continue previous work, and which files connect observations across projects.

## How it works

On startup, the MCP server:
1. Opens `~/.claude-mem/claude-mem.db` (read-only)
2. Loads observations and sessions
3. Builds an in-memory graph with 5 node types and 9 inferred edge types
4. Serves queries via stdio MCP

No background worker. No writes to claude-mem's database. No HTTP port.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `graph_context` | Ranked observations for starting a session on a project. Filters stale decisions, includes session arcs. |
| `graph_related` | All connections to a specific observation (1-2 hops), grouped by edge type. |
| `graph_staleness` | Check if a decision/observation has been superseded by a newer one. |
| `graph_timeline` | Chronological project history showing session chains and key observations. |
| `graph_file_impact` | Find all observations that touched a file, across all projects. |
| `graph_rebuild` | Refresh the graph from the database. |

## Data Model

**Nodes:** Observation, Session, Project, Concept, File

**Edges (inferred):**

| Edge | From - To | Rule |
|------|-----------|------|
| `produced_by` | Observation - Session | FK match |
| `led_to` | Observation - Observation | Same session, type progression (discovery->decision, etc.) |
| `supersedes` | Observation - Observation | Same project, >=50% concept overlap, newer, decision/change only |
| `relates_to` | Observation - Concept | From concepts JSON |
| `touches` | Observation - File | From files_read/files_modified |
| `part_of` | Session - Project | From project field |
| `co_occurs` | Concept - Concept | Same observation, weighted by frequency |
| `depends_on` | Observation - Observation | File overlap (A modified, B read later) |
| `continues` | Session - Session | Same project, file overlap, within 24h |

## Install as Claude Code Plugin

```bash
mkdir -p ~/.claude/plugins/cache/nhangen/claude-mem-graph/0.1.0
cp -r . ~/.claude/plugins/cache/nhangen/claude-mem-graph/0.1.0/
cd ~/.claude/plugins/cache/nhangen/claude-mem-graph/0.1.0 && npm install --production
```

Restart Claude Code. The 6 tools appear automatically.

## Development

```bash
npm install          # install deps
npm test             # run all tests (57 tests)
npm run test:watch   # watch mode
npm run build        # bundle to scripts/mcp-server.cjs
npm run dev          # run MCP server from source
```

### Compare retrieval quality

```bash
./node_modules/.bin/tsx scripts/compare-retrieval.ts <project> [search-term]
```

Shows what graph retrieval finds vs what FTS finds, and what each surfaces uniquely.

## Architecture

```
src/
  types.ts          - TypeScript interfaces
  loader.ts         - SQLite reader with schema validation
  graph.ts          - Graph builder with edge inference
  query.ts          - Query functions for all 6 tools
  mcp-server.ts     - MCP stdio server
```

**Dependencies:** better-sqlite3 (read-only SQLite), graphology (in-memory graph), @modelcontextprotocol/sdk (MCP server)

## Phase 2

This is Phase 1 — a read-only layer over claude-mem. Phase 2 replaces claude-mem entirely with graph-native storage and cost-optimized observation capture. See the [design spec](https://github.com/nhangen/claude-mem-graph/issues/1) for known limitations.
