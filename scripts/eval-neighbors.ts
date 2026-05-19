/**
 * Utility eval driver: dump graph_neighbors output for one or more observation IDs.
 *
 * Usage:
 *   tsx scripts/eval-neighbors.ts <id> [<id> ...]
 *   tsx scripts/eval-neighbors.ts --tsv input.tsv     # tab-separated "task<TAB>id" rows
 *   tsx scripts/eval-neighbors.ts --json input.json   # JSON array [{task, id}, ...]
 *
 * Used during the 2026-05-18 utility eval (vault-side write-up at
 * Obsidian/Projects/Development/nhangen/claude-mem-graph/2026-05-18-utility-eval.md).
 * No vault-specific data lives in this file.
 */
import { readFileSync } from 'fs';
import { openDatabase, loadObservations, loadSessions } from '../src/loader.js';
import { buildGraph } from '../src/graph.js';
import { queryRelated } from '../src/query.js';

interface Row {
  task: string;
  id: number;
}

function parseArgs(argv: string[]): Row[] {
  const args = argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: tsx scripts/eval-neighbors.ts <id> [<id> ...] | --tsv file | --json file');
    process.exit(2);
  }

  if (args[0] === '--tsv') {
    const path = args[1];
    if (!path) throw new Error('--tsv requires a file path');
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [task, id] = line.split('\t');
        return { task: task ?? `obs:${id}`, id: Number(id) };
      });
  }

  if (args[0] === '--json') {
    const path = args[1];
    if (!path) throw new Error('--json requires a file path');
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Row[];
    return parsed.map((r) => ({ task: r.task ?? `obs:${r.id}`, id: Number(r.id) }));
  }

  return args.map((id) => ({ task: `obs:${id}`, id: Number(id) }));
}

const rows = parseArgs(process.argv);

const db = openDatabase();
const obs = loadObservations(db);
const sess = loadSessions(db);
const graph = buildGraph(obs, sess);
db.close();

console.log(`Graph: ${graph.order} nodes, ${graph.size} edges\n`);

for (const { task, id } of rows) {
  console.log(`\n=== ${task} (start obs:${id}) ===`);
  const res = queryRelated(graph, { observationId: id, maxResults: 30 });
  const edgeTypes = Object.keys(res.byEdgeType);
  if (edgeTypes.length === 0) {
    console.log('  NO NEIGHBORS (not in graph or isolated)');
    continue;
  }
  for (const et of edgeTypes) {
    const items = res.byEdgeType[et];
    console.log(`  ${et} (${items.length}):`);
    for (const it of items.slice(0, 8)) {
      console.log(
        `    [${it.hops}h] ${it.nodeType} ${it.nodeKey} — ${(it.label ?? '').slice(0, 100)}`,
      );
    }
    if (items.length > 8) console.log(`    ... ${items.length - 8} more`);
  }
}
