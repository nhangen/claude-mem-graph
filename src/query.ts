import type { GraphType } from './graph.js';
import type {
  Observation,
  Session,
  ContextResult,
  AnnotatedObservation,
  SessionArc,
  RelatedResult,
  RelatedItem,
  StalenessResult,
  TimelineEntry,
  FileImpactResult,
  LineageResult,
  LineageStep,
  ConflictsResult,
  ConflictPair,
  NodeType,
  EdgeType,
} from './types.js';

// --- queryContext ---

export interface QueryContextOptions {
  project?: string;
  taskDescription?: string;
  maxSessions?: number;
  sinceDays?: number;
}

export function queryContext(
  graph: GraphType,
  options: QueryContextOptions,
): ContextResult {
  const { project, taskDescription } = options;
  const defaultMaxSessions = (!project && taskDescription) ? 500 : 50;
  const maxSessions = options.maxSessions ?? defaultMaxSessions;
  const sinceDays = options.sinceDays ?? (taskDescription ? 365 : 90);

  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const projectSessions: Session[] = [];
  graph.forEachNode((nodeKey, attrs) => {
    if (attrs.type !== 'session') return;
    const sess = attrs.data as Session;
    if (project && sess.project !== project) return;
    if (sess.startedAt < cutoff) return;
    projectSessions.push(sess);
  });

  projectSessions.sort((a, b) => b.startedAt - a.startedAt);
  const cappedSessions = projectSessions.slice(0, maxSessions);
  const sessionIdSet = new Set(cappedSessions.map(s => s.contentSessionId));
  const memSessionIdSet = new Set(cappedSessions.map(s => s.memorySessionId).filter(Boolean) as string[]);

  const observations: Observation[] = [];
  graph.forEachNode((nodeKey, attrs) => {
    if (attrs.type !== 'observation') return;
    const obs = attrs.data as Observation;
    if (project && obs.project !== project) return;
    if (!memSessionIdSet.has(obs.sessionId)) return;
    observations.push(obs);
  });

  const keywords = taskDescription
    ? taskDescription.toLowerCase().split(/\s+/).filter(k => k.length > 2)
    : [];

  const filtered = keywords.length > 0
    ? observations.filter(obs => {
        const haystack = [obs.title, obs.subtitle, obs.narrative, obs.text, obs.facts, ...obs.concepts].join(' ').toLowerCase();
        return keywords.some(k => haystack.includes(k));
      })
    : observations;

  const supersededIds = new Set<number>();
  graph.forEachEdge((edge, attrs) => {
    if (attrs.type !== 'supersedes') return;
    const targetKey = graph.target(edge);
    if (targetKey.startsWith('obs:')) {
      const id = parseInt(targetKey.slice(4), 10);
      supersededIds.add(id);
    }
  });

  const supersederOf = new Map<number, number>();
  graph.forEachEdge((edge, attrs) => {
    if (attrs.type !== 'supersedes') return;
    const sourceKey = graph.source(edge);
    const targetKey = graph.target(edge);
    if (sourceKey.startsWith('obs:') && targetKey.startsWith('obs:')) {
      const targetId = parseInt(targetKey.slice(4), 10);
      const sourceId = parseInt(sourceKey.slice(4), 10);
      supersederOf.set(targetId, sourceId);
    }
  });

  const now = Date.now();
  const scored: AnnotatedObservation[] = filtered.map(obs => {
    const nodeKey = `obs:${obs.id}`;
    const degree = graph.hasNode(nodeKey) ? graph.degree(nodeKey) : 0;
    const ageMs = now - obs.createdAt;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const recencyScore = Math.max(0, 1 - ageDays / 365);
    const relevanceScore = Math.min(1, obs.relevanceCount / 10);
    const degreeScore = Math.min(1, degree / 20);
    const score = recencyScore * 0.4 + relevanceScore * 0.3 + degreeScore * 0.3;

    const annotations: string[] = [];
    if (supersededIds.has(obs.id)) {
      const supersederId = supersederOf.get(obs.id);
      if (supersederId != null) {
        annotations.push(`superseded by #${supersederId}`);
      } else {
        annotations.push('superseded');
      }
    }

    return { observation: obs, score, annotations };
  });

  const nonSuperseded = scored.filter(a => !supersededIds.has(a.observation.id));
  const supersededObs = scored.filter(a => supersededIds.has(a.observation.id));

  nonSuperseded.sort((a, b) => b.score - a.score);
  supersededObs.sort((a, b) => b.score - a.score);

  const topObservations = [...nonSuperseded, ...supersededObs].slice(0, 15);

  const sessionArcs = buildSessionArcs(graph, cappedSessions);

  return { observations: topObservations, sessionArcs };
}

function buildSessionArcs(graph: GraphType, sessions: Session[]): SessionArc[] {
  const sessionMap = new Map<string, Session>();
  for (const s of sessions) {
    sessionMap.set(s.contentSessionId, s);
  }

  const visited = new Set<string>();
  const arcs: SessionArc[] = [];

  for (const sess of sessions) {
    const key = `sess:${sess.contentSessionId}`;
    if (visited.has(key)) continue;

    const continuesEdges = graph.filterOutEdges(key, (_e, attrs) => attrs.type === 'continues');
    if (continuesEdges.length === 0) continue;

    const chain: Session[] = [sess];
    visited.add(key);

    let current = key;
    const seen = new Set([current]);
    while (true) {
      const edges = graph.filterOutEdges(current, (_e, attrs) => attrs.type === 'continues');
      if (edges.length === 0) break;
      const nextKey = graph.target(edges[0]);
      if (seen.has(nextKey)) break;
      seen.add(nextKey);
      const nextSess = sessionMap.get(nextKey.slice(5));
      if (!nextSess) break;
      chain.push(nextSess);
      visited.add(nextKey);
      current = nextKey;
    }

    if (chain.length >= 2) {
      arcs.push({ sessions: chain, edgeType: 'continues' });
    }
  }

  return arcs;
}

// --- queryRelated ---

export interface QueryRelatedOptions {
  observationId: number;
  maxResults?: number;
}

export function queryRelated(
  graph: GraphType,
  options: QueryRelatedOptions,
): RelatedResult {
  const { observationId, maxResults = 20 } = options;
  const startKey = `obs:${observationId}`;

  if (!graph.hasNode(startKey)) {
    return { byEdgeType: {} };
  }

  const hop1: RelatedItem[] = [];
  const hop1Keys = new Set<string>();

  graph.forEachEdge(startKey, (edge, attrs, source, target) => {
    const neighborKey = source === startKey ? target : source;
    if (neighborKey === startKey) return;
    hop1Keys.add(neighborKey);
    const nodeAttrs = graph.getNodeAttributes(neighborKey);
    hop1.push({
      nodeKey: neighborKey,
      nodeType: nodeAttrs.type as NodeType,
      label: nodeAttrs.label,
      edgeType: attrs.type as EdgeType,
      hops: 1,
    });
  });

  const hop2: RelatedItem[] = [];
  const hop2Keys = new Set<string>();

  for (const hop1Key of hop1Keys) {
    graph.forEachEdge(hop1Key, (edge, attrs, source, target) => {
      if (attrs.type === 'co_occurs' && (attrs.weight as number) < 2) return;
      const neighborKey = source === hop1Key ? target : source;
      if (neighborKey === startKey) return;
      if (hop1Keys.has(neighborKey)) return;
      if (hop2Keys.has(neighborKey)) return;
      hop2Keys.add(neighborKey);
      const nodeAttrs = graph.getNodeAttributes(neighborKey);
      hop2.push({
        nodeKey: neighborKey,
        nodeType: nodeAttrs.type as NodeType,
        label: nodeAttrs.label,
        edgeType: attrs.type as EdgeType,
        hops: 2,
      });
    });
  }

  const all = [...hop1, ...hop2].slice(0, maxResults);

  const byEdgeType: Record<string, RelatedItem[]> = {};
  for (const item of all) {
    const group = byEdgeType[item.edgeType] ?? [];
    group.push(item);
    byEdgeType[item.edgeType] = group;
  }

  return { byEdgeType };
}

// --- queryStaleness ---

export interface QueryStalenessOptions {
  observationId: number;
}

export function queryStaleness(
  graph: GraphType,
  options: QueryStalenessOptions,
): StalenessResult {
  const { observationId } = options;
  const nodeKey = `obs:${observationId}`;

  if (!graph.hasNode(nodeKey)) {
    return {
      status: 'uncertain',
      supersededBy: null,
      reason: `Observation #${observationId} not found in graph`,
    };
  }

  let supersededByKey: string | null = null;

  graph.forEachInEdge(nodeKey, (edge, attrs) => {
    if (attrs.type === 'supersedes') {
      supersededByKey = graph.source(edge);
    }
  });

  if (supersededByKey) {
    const supersederId = parseInt((supersededByKey as string).slice(4), 10);
    return {
      status: 'stale',
      supersededBy: supersederId,
      reason: `Observation #${observationId} was superseded by #${supersederId}`,
    };
  }

  return {
    status: 'current',
    supersededBy: null,
    reason: `Observation #${observationId} has not been superseded`,
  };
}

// --- queryTimeline ---

export interface QueryTimelineOptions {
  project: string;
  since?: number;
}

export function queryTimeline(
  graph: GraphType,
  options: QueryTimelineOptions,
): TimelineEntry[] {
  const { project, since } = options;
  const cutoff = since ?? Date.now() - 30 * 24 * 60 * 60 * 1000;

  const projectSessions: Session[] = [];
  graph.forEachNode((nodeKey, attrs) => {
    if (attrs.type !== 'session') return;
    const sess = attrs.data as Session;
    if (sess.project !== project) return;
    if (sess.startedAt < cutoff) return;
    projectSessions.push(sess);
  });

  projectSessions.sort((a, b) => a.startedAt - b.startedAt);

  const entries: TimelineEntry[] = [];

  for (const sess of projectSessions) {
    const sessKey = `sess:${sess.contentSessionId}`;

    const obsForSession: Observation[] = [];
    graph.forEachInEdge(sessKey, (edge, attrs) => {
      if (attrs.type === 'produced_by') {
        const obsKey = graph.source(edge);
        const obsAttrs = graph.getNodeAttributes(obsKey);
        if (obsAttrs.type === 'observation') {
          obsForSession.push(obsAttrs.data as Observation);
        }
      }
    });

    obsForSession.sort((a, b) => a.createdAt - b.createdAt);

    let continuesFrom: string | null = null;
    const continuesEdges = graph.filterOutEdges(sessKey, (_e, attrs) => attrs.type === 'continues');
    if (continuesEdges.length > 0) {
      const targetKey = graph.target(continuesEdges[0]);
      continuesFrom = targetKey.slice(5);
    }

    entries.push({ session: sess, observations: obsForSession, continuesFrom });
  }

  return entries;
}

// --- queryFileImpact ---

export interface QueryFileImpactOptions {
  filePath: string;
}

export function queryFileImpact(
  graph: GraphType,
  options: QueryFileImpactOptions,
): FileImpactResult {
  const { filePath } = options;
  const fileKey = `file:${filePath}`;

  if (!graph.hasNode(fileKey)) {
    return { filePath, byProject: {} };
  }

  const byProject: Record<string, Observation[]> = {};

  graph.forEachInEdge(fileKey, (edge, attrs) => {
    if (attrs.type !== 'touches') return;
    const obsKey = graph.source(edge);
    const obsAttrs = graph.getNodeAttributes(obsKey);
    if (obsAttrs.type !== 'observation') return;
    const obs = obsAttrs.data as Observation;
    const group = byProject[obs.project] ?? [];
    group.push(obs);
    byProject[obs.project] = group;
  });

  return { filePath, byProject };
}

// --- queryLineage ---

export interface QueryLineageOptions {
  observationId: number;
  maxDepth?: number;
}

export function queryLineage(
  graph: GraphType,
  options: QueryLineageOptions,
): LineageResult {
  const { observationId, maxDepth = 20 } = options;
  const startKey = `obs:${observationId}`;

  if (!graph.hasNode(startKey)) {
    return { chain: [], rootId: observationId };
  }

  const startAttrs = graph.getNodeAttributes(startKey);
  const startObs = startAttrs.data as Observation;

  const chain: LineageStep[] = [{
    observation: startObs,
    edgeType: 'led_to',
    direction: 'root',
  }];

  const visited = new Set<string>([startKey]);
  const causalEdges: Set<EdgeType> = new Set(['led_to', 'depends_on', 'supersedes']);

  let current = startKey;
  for (let depth = 0; depth < maxDepth; depth++) {
    let foundPrev: { key: string; obs: Observation; edgeType: EdgeType } | null = null;

    graph.forEachInEdge(current, (edge, attrs) => {
      if (foundPrev) return;
      if (!causalEdges.has(attrs.type as EdgeType)) return;
      const sourceKey = graph.source(edge);
      if (!sourceKey.startsWith('obs:')) return;
      if (visited.has(sourceKey)) return;
      const sourceAttrs = graph.getNodeAttributes(sourceKey);
      if (sourceAttrs.type !== 'observation') return;
      foundPrev = {
        key: sourceKey,
        obs: sourceAttrs.data as Observation,
        edgeType: attrs.type as EdgeType,
      };
    });

    if (!foundPrev) {
      graph.forEachOutEdge(current, (edge, attrs) => {
        if (foundPrev) return;
        if (!causalEdges.has(attrs.type as EdgeType)) return;
        const targetKey = graph.target(edge);
        if (!targetKey.startsWith('obs:')) return;
        if (visited.has(targetKey)) return;
        const targetAttrs = graph.getNodeAttributes(targetKey);
        if (targetAttrs.type !== 'observation') return;
        const targetObs = targetAttrs.data as Observation;
        if (targetObs.createdAt < (graph.getNodeAttributes(current).data as Observation).createdAt) {
          foundPrev = {
            key: targetKey,
            obs: targetObs,
            edgeType: attrs.type as EdgeType,
          };
        }
      });
    }

    if (!foundPrev) break;

    visited.add(foundPrev.key);
    chain.push({
      observation: foundPrev.obs,
      edgeType: foundPrev.edgeType,
      direction: 'backward',
    });
    current = foundPrev.key;
  }

  chain.reverse();
  const rootId = chain.length > 0 ? chain[0].observation.id : observationId;

  return { chain, rootId };
}

// --- queryConflicts ---

export interface QueryConflictsOptions {
  observationId: number;
}

const CONFLICT_STOPWORDS = new Set([
  'how-it-works', 'pattern', 'what-changed', 'problem-solution', 'gotcha',
  'trade-off', 'why-it-exists', 'best-practice',
]);

export function queryConflicts(
  graph: GraphType,
  options: QueryConflictsOptions,
): ConflictsResult {
  const { observationId } = options;
  const startKey = `obs:${observationId}`;

  if (!graph.hasNode(startKey)) {
    return { pairs: [] };
  }

  const startAttrs = graph.getNodeAttributes(startKey);
  const startObs = startAttrs.data as Observation;
  const pairs: ConflictPair[] = [];
  const seen = new Set<number>();

  graph.forEachInEdge(startKey, (edge, attrs) => {
    if (attrs.type !== 'supersedes') return;
    const sourceKey = graph.source(edge);
    if (!sourceKey.startsWith('obs:')) return;
    const sourceAttrs = graph.getNodeAttributes(sourceKey);
    const superseder = sourceAttrs.data as Observation;
    if (seen.has(superseder.id)) return;
    seen.add(superseder.id);
    const shared = startObs.concepts.filter(c =>
      !CONFLICT_STOPWORDS.has(c) && superseder.concepts.includes(c)
    );
    pairs.push({
      current: superseder,
      conflicting: startObs,
      relationship: 'supersedes',
      sharedConcepts: shared,
    });
  });

  graph.forEachOutEdge(startKey, (edge, attrs) => {
    if (attrs.type !== 'supersedes') return;
    const targetKey = graph.target(edge);
    if (!targetKey.startsWith('obs:')) return;
    const targetAttrs = graph.getNodeAttributes(targetKey);
    const superseded = targetAttrs.data as Observation;
    if (seen.has(superseded.id)) return;
    seen.add(superseded.id);
    const shared = startObs.concepts.filter(c =>
      !CONFLICT_STOPWORDS.has(c) && superseded.concepts.includes(c)
    );
    pairs.push({
      current: startObs,
      conflicting: superseded,
      relationship: 'supersedes',
      sharedConcepts: shared,
    });
  });

  const startConcepts = startObs.concepts.filter(c => !CONFLICT_STOPWORDS.has(c));
  if (startConcepts.length > 0) {
    graph.forEachNode((nodeKey, attrs) => {
      if (attrs.type !== 'observation') return;
      const obs = attrs.data as Observation;
      if (obs.id === observationId) return;
      if (seen.has(obs.id)) return;
      const obsConcepts = obs.concepts.filter(c => !CONFLICT_STOPWORDS.has(c));
      if (obsConcepts.length === 0) return;
      const shared = startConcepts.filter(c => obsConcepts.includes(c));
      const overlapRatio = shared.length / Math.min(startConcepts.length, obsConcepts.length);
      if (overlapRatio < 0.5) return;
      if (obs.type !== startObs.type) return;
      const [newer, older] = obs.createdAt > startObs.createdAt
        ? [obs, startObs]
        : [startObs, obs];
      seen.add(obs.id);
      pairs.push({
        current: newer,
        conflicting: older,
        relationship: 'concept_overlap',
        sharedConcepts: shared,
      });
    });
  }

  return { pairs };
}
