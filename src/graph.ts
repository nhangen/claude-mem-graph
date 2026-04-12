import { MultiDirectedGraph } from 'graphology';
import type { Observation, Session, NodeAttributes, EdgeAttributes } from './types.js';

export type GraphType = MultiDirectedGraph<NodeAttributes, EdgeAttributes>;

export function buildGraph(observations: Observation[], sessions: Session[]): GraphType {
  const graph: GraphType = new MultiDirectedGraph<NodeAttributes, EdgeAttributes>();

  addNodes(graph, observations, sessions);
  addProducedByEdges(graph, observations, sessions);
  addLedToEdges(graph, observations);
  addSupersedesEdges(graph, observations);
  addRelatesToEdges(graph, observations);
  addTouchesEdges(graph, observations);
  addPartOfEdges(graph, sessions);
  addCoOccursEdges(graph, observations);
  addDependsOnEdges(graph, observations);
  addContinuesEdges(graph, observations, sessions);

  return graph;
}

function safeAddEdge(
  graph: GraphType,
  from: string,
  to: string,
  attrs: EdgeAttributes,
): void {
  if (graph.hasNode(from) && graph.hasNode(to)) {
    graph.addEdge(from, to, attrs);
  }
}

function addNodes(
  graph: GraphType,
  observations: Observation[],
  sessions: Session[],
): void {
  for (const obs of observations) {
    const key = `obs:${obs.id}`;
    if (!graph.hasNode(key)) {
      graph.addNode(key, { type: 'observation', label: obs.title, data: obs });
    }
  }

  for (const sess of sessions) {
    const key = `sess:${sess.contentSessionId}`;
    if (!graph.hasNode(key)) {
      graph.addNode(key, { type: 'session', label: sess.contentSessionId, data: sess });
    }
  }

  const projects = new Set<string>();
  for (const obs of observations) projects.add(obs.project);
  for (const sess of sessions) projects.add(sess.project);
  for (const proj of projects) {
    const key = `proj:${proj}`;
    if (!graph.hasNode(key)) {
      graph.addNode(key, { type: 'project', label: proj, data: proj });
    }
  }

  for (const obs of observations) {
    for (const concept of obs.concepts) {
      const key = `concept:${concept}`;
      if (!graph.hasNode(key)) {
        graph.addNode(key, { type: 'concept', label: concept, data: concept });
      }
    }
  }

  for (const obs of observations) {
    for (const file of [...obs.filesRead, ...obs.filesModified]) {
      const key = `file:${file}`;
      if (!graph.hasNode(key)) {
        graph.addNode(key, { type: 'file', label: file, data: file });
      }
    }
  }
}

function addProducedByEdges(
  graph: GraphType,
  observations: Observation[],
  sessions: Session[],
): void {
  const memToSession = new Map<string, string>();
  for (const sess of sessions) {
    if (sess.memorySessionId) {
      memToSession.set(sess.memorySessionId, sess.contentSessionId);
    }
  }

  for (const obs of observations) {
    const contentSessionId = memToSession.get(obs.sessionId);
    if (contentSessionId) {
      safeAddEdge(graph, `obs:${obs.id}`, `sess:${contentSessionId}`, {
        type: 'produced_by',
        weight: 1,
      });
    }
  }
}

const LED_TO_RULES: Partial<Record<Observation['type'], Set<Observation['type']>>> = {
  discovery: new Set(['decision', 'bugfix', 'feature']),
  decision: new Set(['feature', 'change']),
};

function addLedToEdges(graph: GraphType, observations: Observation[]): void {
  const bySession = groupBy(observations, o => o.sessionId);

  for (const group of bySession.values()) {
    const sorted = [...group].sort((a, b) => (a.promptNumber ?? 0) - (b.promptNumber ?? 0));
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const allowed = LED_TO_RULES[from.type];
      if (allowed?.has(to.type)) {
        safeAddEdge(graph, `obs:${from.id}`, `obs:${to.id}`, { type: 'led_to', weight: 1 });
      }
    }
  }
}

const CONCEPT_STOPWORDS = new Set([
  'how-it-works', 'pattern', 'what-changed', 'problem-solution', 'gotcha',
  'trade-off', 'why-it-exists', 'best-practice',
]);

function conceptOverlapRatio(a: string[], b: string[]): number {
  const setA = new Set(a);
  const intersection = b.filter(c => setA.has(c));
  const minLen = Math.min(a.length, b.length);
  if (minLen === 0) return 0;
  return intersection.length / minLen;
}

const SUPERSEDES_TYPES: Set<Observation['type']> = new Set(['decision', 'change']);

function addSupersedesEdges(graph: GraphType, observations: Observation[]): void {
  const eligible = observations.filter(o => SUPERSEDES_TYPES.has(o.type));

  for (let i = 0; i < eligible.length; i++) {
    for (let j = 0; j < eligible.length; j++) {
      if (i === j) continue;
      const newer = eligible[i];
      const older = eligible[j];
      if (newer.createdAt <= older.createdAt) continue;
      if (newer.project !== older.project) continue;
      const newerConcepts = newer.concepts.filter(c => !CONCEPT_STOPWORDS.has(c));
      const olderConcepts = older.concepts.filter(c => !CONCEPT_STOPWORDS.has(c));
      if (newerConcepts.length === 0 || olderConcepts.length === 0) continue;
      if (conceptOverlapRatio(newerConcepts, olderConcepts) >= 0.5) {
        safeAddEdge(graph, `obs:${newer.id}`, `obs:${older.id}`, {
          type: 'supersedes',
          weight: 1,
        });
      }
    }
  }
}

function addRelatesToEdges(graph: GraphType, observations: Observation[]): void {
  for (const obs of observations) {
    for (const concept of obs.concepts) {
      safeAddEdge(graph, `obs:${obs.id}`, `concept:${concept}`, {
        type: 'relates_to',
        weight: 1,
      });
    }
  }
}

function addTouchesEdges(graph: GraphType, observations: Observation[]): void {
  for (const obs of observations) {
    const files = new Set([...obs.filesRead, ...obs.filesModified]);
    for (const file of files) {
      safeAddEdge(graph, `obs:${obs.id}`, `file:${file}`, { type: 'touches', weight: 1 });
    }
  }
}

function addPartOfEdges(graph: GraphType, sessions: Session[]): void {
  for (const sess of sessions) {
    safeAddEdge(graph, `sess:${sess.contentSessionId}`, `proj:${sess.project}`, {
      type: 'part_of',
      weight: 1,
    });
  }
}

function addCoOccursEdges(graph: GraphType, observations: Observation[]): void {
  const pairCounts = new Map<string, number>();

  for (const obs of observations) {
    const concepts = obs.concepts;
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const a = concepts[i] < concepts[j] ? concepts[i] : concepts[j];
        const b = concepts[i] < concepts[j] ? concepts[j] : concepts[i];
        const key = `${a}|||${b}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  for (const [key, weight] of pairCounts) {
    const [a, b] = key.split('|||');
    safeAddEdge(graph, `concept:${a}`, `concept:${b}`, { type: 'co_occurs', weight });
  }
}

function addDependsOnEdges(graph: GraphType, observations: Observation[]): void {
  const sorted = [...observations].sort((a, b) => a.createdAt - b.createdAt);

  for (let i = 0; i < sorted.length; i++) {
    const reader = sorted[i];
    if (reader.filesRead.length === 0) continue;

    const readSet = new Set(reader.filesRead);

    for (let j = 0; j < i; j++) {
      const modifier = sorted[j];
      if (modifier.createdAt >= reader.createdAt) continue;
      const modified = modifier.filesModified.filter(f => readSet.has(f));
      if (modified.length > 0) {
        safeAddEdge(graph, `obs:${reader.id}`, `obs:${modifier.id}`, {
          type: 'depends_on',
          weight: 1,
        });
      }
    }
  }
}

function addContinuesEdges(
  graph: GraphType,
  observations: Observation[],
  sessions: Session[],
): void {
  const sessionFiles = new Map<string, { read: Set<string>; modified: Set<string> }>();

  for (const sess of sessions) {
    sessionFiles.set(sess.contentSessionId, { read: new Set(), modified: new Set() });
  }

  const memToContent = new Map<string, string>();
  for (const sess of sessions) {
    if (sess.memorySessionId) {
      memToContent.set(sess.memorySessionId, sess.contentSessionId);
    }
  }

  for (const obs of observations) {
    const contentId = memToContent.get(obs.sessionId);
    if (!contentId) continue;
    const entry = sessionFiles.get(contentId);
    if (!entry) continue;
    for (const f of obs.filesRead) entry.read.add(f);
    for (const f of obs.filesModified) entry.modified.add(f);
  }

  const sorted = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const MS_24H = 24 * 60 * 60 * 1000;

  for (let i = 1; i < sorted.length; i++) {
    const later = sorted[i];
    const laterFiles = sessionFiles.get(later.contentSessionId);
    if (!laterFiles) continue;
    if (laterFiles.read.size === 0 && laterFiles.modified.size === 0) continue;

    for (let j = 0; j < i; j++) {
      const earlier = sorted[j];
      if (earlier.project !== later.project) continue;

      const earlierEnd = earlier.completedAt ?? earlier.startedAt;
      const gap = later.startedAt - earlierEnd;
      if (gap > MS_24H || gap < 0) continue;

      const earlierFiles = sessionFiles.get(earlier.contentSessionId);
      if (!earlierFiles) continue;

      const earlierAllFiles = new Set([...earlierFiles.read, ...earlierFiles.modified]);
      const laterAllFiles = new Set([...laterFiles.read, ...laterFiles.modified]);

      const hasOverlap = [...earlierFiles.modified].some(f => laterAllFiles.has(f)) ||
        [...earlierAllFiles].some(f => laterFiles.modified.has(f));

      if (hasOverlap) {
        safeAddEdge(graph, `sess:${later.contentSessionId}`, `sess:${earlier.contentSessionId}`, {
          type: 'continues',
          weight: 1,
        });
      }
    }
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k) ?? [];
    arr.push(item);
    map.set(k, arr);
  }
  return map;
}
