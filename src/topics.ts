import type { Observation } from './types.js';
import { TOPIC_STOPWORDS } from './stopwords.js';

const MAX_TEXT_CHARS = 600;
const TOKEN_RE = /[a-z][a-z0-9]{3,31}/g;

function tokenize(text: string): string[] {
  const slice = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const matches = slice.toLowerCase().match(TOKEN_RE);
  if (!matches) return [];
  const out: string[] = [];
  for (const w of matches) {
    if (!TOPIC_STOPWORDS.has(w)) out.push(w);
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
