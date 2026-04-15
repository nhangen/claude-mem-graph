# claude-mem-graph

Causal tracing layer over [claude-mem](https://github.com/thedotmack/claude-mem). Reads claude-mem's SQLite database, builds an in-memory knowledge graph, and exposes MCP tools for tracing the story around observations.

## Why

claude-mem stores observations as flat rows with keyword/vector search. It can find things, but can't tell you what led to what. This plugin adds causal tracing: what happened before this observation, what happened after, what files connect it to other work, and which sessions continue previous sessions.

**Use flat search to find the node. Use graph neighbors to trace the story around it.**

## How it works

On startup, the MCP server:
1. Opens `~/.claude-mem/claude-mem.db` (read-only)
2. Loads observations and sessions
3. Builds an in-memory graph with 5 node types and 10 edge types
4. Extracts 1,300+ causal edges from observation narrative text
5. Serves queries via stdio MCP

No background worker. No writes to claude-mem's database. No HTTP port.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `graph_search` | Cross-project keyword search across all observation text fields. Returns results ranked by recency, relevance, and graph connectivity. |
| `graph_neighbors` | Trace connections from a known observation (1-2 hops). Shows causal chains, shared files, session context. This is the core value. |
| `graph_timeline` | Chronological project history showing which sessions continue previous work. |
| `graph_file_history` | Find all observations that read or modified a file, across all projects. |
| `graph_rebuild` | Refresh the graph from the database. |

## Examples

### Find and trace a causal chain

```
> Use graph_search to find observations about "HubSpot migration"

graph_search(task_description="hubspot migration")
→ 15 results including #380 "HubSpot Contact Lists API Migration from v1 to v3"

> Now trace what's connected to #380

graph_neighbors(observation_id=380)
→ informed_by: #375 "Fixed incorrect string literal usage of Hubspot constant"
→ depends_on: #383 "Restored clean HubSpot provider file"
→ led_to: #382 "HubSpot List ID Migration from v1 to v3"
→ touches: src/HubSpot/V3Client.php, src/HubSpot/Client.php
→ produced_by: session sess-a (April 1 work session)
```

### See project history with session arcs

```
> Show me the wp-content timeline since March

graph_timeline(project="wp-content", since="2026-03-01")
→ 2026-03-16 — session abc12345 [completed]
    - #340 bugfix: Fixed auto-upgrade tax calculation
    - #341 change: Added order notes for tax adjustments
→ 2026-03-27 — session def67890 (continues abc12345) [completed]
    - #380 discovery: HubSpot Contact Lists API Migration
    - #382 feature: HubSpot List ID Migration
```

### Find what touched a file across projects

```
> What observations involved UserVat.php?

graph_file_history(file_path="plugins/omappv4-core/src/Checkout/Taxes/Vat/UserVat.php")
→ wp-content:
    - #340 bugfix: Fixed auto-upgrade tax calculation
    - #354 bugfix: Prevent empty-string country from poisoning cache
→ wp-content-vat-fix:
    - #360 change: Added trim() to country field handling
```

### Check usage analytics

```bash
npm run stats
```

Shows calls by tool, daily trends, top queries, workflow patterns (search→neighbors vs standalone), empty result rate, and most-traced observation IDs.

## Data Model

**Nodes:** Observation, Session, Project, Concept, File

**Edges:**

| Edge | What it means | How it's inferred |
|------|---------------|-------------------|
| `informed_by` | **Causal link** — observation cites a reason found in another observation | Narrative text pattern matching ("because", "due to", "based on", etc.) matched against observation titles. ~1,300 edges. |
| `led_to` | Type progression within a session | discovery→decision, discovery→bugfix, decision→feature |
| `depends_on` | File dependency — A modified a file, B read it later | File overlap with temporal ordering |
| `continues` | Session continuation — same project, overlapping files, within 24h | Session-level file overlap |
| `produced_by` | Observation belongs to session | FK match |
| `relates_to` | Observation tagged with concept | From concepts JSON |
| `touches` | Observation read or modified file | From files_read/files_modified |
| `part_of` | Session belongs to project | From project field |
| `co_occurs` | Concepts appear together | Same observation, weighted by frequency |
| `supersedes` | Newer decision replaces older | Same project, 50%+ concept overlap, decision/change types |

The first four edge types (`informed_by`, `led_to`, `depends_on`, `continues`) provide causal tracing. The rest provide structural context.

## Install

Via the nhangen-tools marketplace:
```bash
claude plugin marketplace add nhangen/claude-plugins
claude plugin install claude-mem-graph@nhangen-tools
```

Or manually:
```bash
mkdir -p ~/.claude/plugins/cache/nhangen/claude-mem-graph/0.1.0
cp -r . ~/.claude/plugins/cache/nhangen/claude-mem-graph/0.1.0/
cd ~/.claude/plugins/cache/nhangen/claude-mem-graph/0.1.0 && npm install --production
```

Restart Claude Code. The 5 tools appear automatically.

## Development

```bash
npm install          # install deps
npm test             # run all tests (73 tests)
npm run test:watch   # watch mode
npm run build        # bundle to scripts/mcp-server.cjs
npm run dev          # run MCP server from source
```

## Architecture

```
src/
  types.ts          - TypeScript interfaces
  loader.ts         - SQLite reader with schema validation
  graph.ts          - Graph builder with edge inference + narrative causal extraction
  query.ts          - Query functions for all 5 tools
  mcp-server.ts     - MCP stdio server
```

**Dependencies:** better-sqlite3 (read-only SQLite), graphology (in-memory graph), @modelcontextprotocol/sdk (MCP server)

## Known Limitations

- **Not a search replacement.** Flat semantic search outperforms `graph_search` for keyword retrieval. The graph's value is in tracing connections, not finding things.
- **Concept edges are noisy.** claude-mem assigns generic concepts (how-it-works, pattern) that don't discriminate between observations. See [#1](https://github.com/nhangen/claude-mem-graph/issues/1).
- **Causal edges are text-heuristic.** `informed_by` edges use pattern matching on narrative text, not semantic understanding. ~15% of observations contain extractable causal language.

## Telemetry

Tool calls are logged to `~/.claude-mem-graph/usage.jsonl` with session ID, workspace, tool name, params, and result count.

Run `npm run stats` for an analytics report:
- Calls by tool with empty-result rates
- Daily usage trends
- Top search queries
- Workflow patterns (search→neighbors, standalone tracing, etc.)
- Most-traced observation IDs
