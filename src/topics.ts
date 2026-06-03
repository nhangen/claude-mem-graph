import type { Observation } from './types.js';

const STOPWORDS = new Set([
  'the', 'this', 'that', 'with', 'from', 'were', 'been', 'have', 'has', 'had', 'was', 'for',
  'are', 'but', 'not', 'you', 'all', 'can', 'her', 'one', 'our', 'out', 'its', 'also', 'into',
  'more', 'some', 'such', 'than', 'them', 'then', 'only', 'when', 'will', 'each', 'make',
  'like', 'over', 'after', 'which', 'their', 'would', 'about', 'these', 'other', 'could',
  'being', 'first', 'using', 'where', 'while', 'there', 'should', 'still', 'does', 'both',
  'they', 'what', 'before', 'between', 'because', 'against', 'through', 'during', 'under',
  'until', 'upon', 'within', 'without', 'across', 'along', 'around', 'instead', 'rather',
  'now', 'new', 'old', 'just', 'very', 'much', 'most', 'many', 'few', 'any', 'every',
  'always', 'never', 'often', 'once', 'twice', 'here', 'how', 'who', 'why', 'whose',
  'add', 'added', 'adds', 'fix', 'fixed', 'fixes', 'use', 'used', 'uses', 'set', 'sets',
  'get', 'gets', 'got', 'run', 'runs', 'ran', 'put', 'puts', 'see', 'sees', 'saw',
  'made', 'making', 'doing', 'done', 'goes', 'going', 'went', 'comes', 'came', 'gave',
  'gets', 'taken', 'took', 'taking', 'said', 'says', 'tell', 'told',
  'observation', 'observations', 'session', 'sessions', 'project', 'projects',
  'note', 'notes', 'code', 'file', 'files', 'function', 'functions', 'method', 'methods',
  'class', 'classes', 'module', 'modules', 'package', 'packages',
]);

const MAX_TEXT_CHARS = 600;
const TOKEN_RE = /[a-z][a-z0-9]{3,31}/g;

function tokenize(text: string): string[] {
  const slice = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const matches = slice.toLowerCase().match(TOKEN_RE);
  if (!matches) return [];
  const out: string[] = [];
  for (const w of matches) {
    if (!STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

export interface TopicIndex {
  topicsByObs: Map<number, Set<string>>;
}

const TOP_K = 5;
const MIN_TFIDF = 0.5;

export function extractDomainTopics(observations: Observation[]): TopicIndex {
  const topicsByObs = new Map<number, Set<string>>();

  const byProject = new Map<string, Observation[]>();
  for (const obs of observations) {
    const arr = byProject.get(obs.project) ?? [];
    arr.push(obs);
    byProject.set(obs.project, arr);
  }

  for (const projectObs of byProject.values()) {
    const N = projectObs.length;
    const docFreq = new Map<string, number>();
    const obsTokens = new Map<number, Map<string, number>>();

    for (const obs of projectObs) {
      const text = `${obs.title} ${obs.narrative}`;
      const tokens = tokenize(text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      obsTokens.set(obs.id, tf);
      for (const term of tf.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }

    for (const obs of projectObs) {
      const tf = obsTokens.get(obs.id);
      if (!tf || tf.size === 0) {
        topicsByObs.set(obs.id, new Set());
        continue;
      }
      const scored: Array<[string, number]> = [];
      for (const [term, count] of tf) {
        const df = docFreq.get(term) ?? 1;
        if (df === N && N > 1) continue;
        const idf = Math.log((N + 1) / (df + 1)) + 1;
        const score = count * idf;
        if (score >= MIN_TFIDF) scored.push([term, score]);
      }
      scored.sort((a, b) => b[1] - a[1]);
      const top = new Set(scored.slice(0, TOP_K).map(([t]) => t));
      topicsByObs.set(obs.id, top);
    }
  }

  return { topicsByObs };
}
