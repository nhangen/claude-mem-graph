// --- Database row types (match claude-mem schema v24-v26) ---

export interface ObservationRow {
  id: number;
  memory_session_id: string;
  project: string;
  type: 'discovery' | 'change' | 'bugfix' | 'feature' | 'decision' | 'refactor';
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  relevance_count: number;
  created_at_epoch: number;
}

export interface SessionRow {
  id: number;
  content_session_id: string;
  memory_session_id: string | null;
  project: string;
  started_at_epoch: number;
  completed_at_epoch: number | null;
  status: 'active' | 'completed' | 'failed';
}

export interface SchemaVersionRow {
  id: number;
  version: number;
  created_at: string;
}

export interface Observation {
  id: number;
  sessionId: string;
  project: string;
  type: ObservationRow['type'];
  title: string;
  subtitle: string;
  narrative: string;
  text: string;
  facts: string;
  concepts: string[];
  filesRead: string[];
  filesModified: string[];
  promptNumber: number | null;
  relevanceCount: number;
  createdAt: number;
}

export interface Session {
  id: number;
  contentSessionId: string;
  memorySessionId: string | null;
  project: string;
  startedAt: number;
  completedAt: number | null;
  status: SessionRow['status'];
}

export type EdgeType =
  | 'produced_by' | 'led_to' | 'supersedes' | 'relates_to'
  | 'touches' | 'part_of' | 'co_occurs' | 'depends_on' | 'continues' | 'informed_by';

export interface EdgeAttributes {
  type: EdgeType;
  weight: number;
}

export type NodeType = 'observation' | 'session' | 'project' | 'concept' | 'file';

export interface NodeAttributes {
  type: NodeType;
  label: string;
  data: Observation | Session | string;
}

export interface ContextResult {
  observations: AnnotatedObservation[];
  sessionArcs: SessionArc[];
}

export interface AnnotatedObservation {
  observation: Observation;
  score: number;
  annotations: string[];
}

export interface SessionArc {
  sessions: Session[];
  edgeType: 'continues';
}

export interface RelatedResult {
  byEdgeType: Record<string, RelatedItem[]>;
}

export interface RelatedItem {
  nodeKey: string;
  nodeType: NodeType;
  label: string;
  edgeType: EdgeType;
  hops: number;
}

export interface StalenessResult {
  status: 'current' | 'stale' | 'uncertain';
  supersededBy: number | null;
  reason: string;
}

export interface TimelineEntry {
  session: Session;
  observations: Observation[];
  continuesFrom: string | null;
}

export interface FileImpactResult {
  filePath: string;
  byProject: Record<string, Observation[]>;
}

export interface LineageStep {
  observation: Observation;
  edgeType: EdgeType;
  direction: 'backward' | 'root';
}

export interface LineageResult {
  chain: LineageStep[];
  rootId: number;
}

export interface ConflictPair {
  current: Observation;
  conflicting: Observation;
  relationship: 'supersedes' | 'concept_overlap';
  sharedConcepts: string[];
}

export interface ConflictsResult {
  pairs: ConflictPair[];
}

export interface RebuildResult {
  nodeCount: number;
  edgeCount: number;
  buildTimeMs: number;
}

export const SUPPORTED_SCHEMA_VERSIONS = { min: 24, max: 26 } as const;
export const DEFAULT_DB_PATH = `${process.env.HOME}/.claude-mem/claude-mem.db`;
