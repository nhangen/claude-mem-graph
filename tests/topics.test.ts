import { describe, it, expect } from 'vitest';
import { extractDomainTopics } from '../src/topics.js';
import type { Observation } from '../src/types.js';

function mkObs(id: number, project: string, title: string, narrative = ''): Observation {
  return {
    id,
    sessionId: `sess-${id}`,
    project,
    type: 'decision',
    title,
    subtitle: '',
    narrative,
    text: '',
    facts: '',
    concepts: [],
    filesRead: [],
    filesModified: [],
    promptNumber: 1,
    relevanceCount: 0,
    createdAt: id * 1000,
    metadata: {},
  };
}

describe('extractDomainTopics', () => {
  it('returns empty topics for empty input', () => {
    const { topicsByObs } = extractDomainTopics([]);
    expect(topicsByObs.size).toBe(0);
  });

  it('extracts distinguishing terms with TF-IDF', () => {
    const obs = [
      mkObs(1, 'p', 'HubSpot v3 lists migration', 'migrating contact lists from v1 to v3 API'),
      mkObs(2, 'p', 'Stripe webhook handling', 'webhook signature verification for stripe events'),
      mkObs(3, 'p', 'HubSpot batch endpoint', 'batch resolve for hubspot contact lists'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);

    const t1 = topicsByObs.get(1)!;
    const t2 = topicsByObs.get(2)!;
    expect(t1.has('hubspot')).toBe(true);
    expect(t2.has('stripe')).toBe(true);
    expect(t1.has('stripe')).toBe(false);
  });

  it('scopes topics per project', () => {
    const obs = [
      mkObs(1, 'a', 'shared term billing flow', 'billing'),
      mkObs(2, 'b', 'billing in another project', 'billing'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);
    expect(topicsByObs.get(1)!.has('billing')).toBe(true);
    expect(topicsByObs.get(2)!.has('billing')).toBe(true);
  });

  it('caps topics at TOP_K=5 even when more candidates clear MIN_TFIDF', () => {
    // 8 unique 4+-char tokens in obs 1; decoy obs ensures none have df===N.
    const obs = [
      mkObs(1, 'p', 'alpha gamma delta zulu yankee xray whiskey victor'),
      mkObs(2, 'p', 'unrelated subject domain', 'separate corpus content'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);
    expect(topicsByObs.get(1)!.size).toBe(5);
  });

  it('exercises the stopword filter (not just the length floor)', () => {
    // 'because', 'always', 'about' are 6/6/5 chars — survive length floor.
    // Decoy obs prevents df===N suppression of 'genuine' and 'topic'.
    const obs = [
      mkObs(1, 'p', 'because always about genuine topic terms here'),
      mkObs(2, 'p', 'separate corpus content unrelated'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);
    const topics = topicsByObs.get(1)!;
    expect(topics.has('because')).toBe(false);
    expect(topics.has('always')).toBe(false);
    expect(topics.has('about')).toBe(false);
    expect(topics.has('genuine')).toBe(true);
  });

  it('suppresses tokens with df===N (appear in every doc)', () => {
    const obs = [
      mkObs(1, 'p', 'common distinctive alpha'),
      mkObs(2, 'p', 'common other beta'),
      mkObs(3, 'p', 'common another gamma'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);
    for (const id of [1, 2, 3]) {
      expect(topicsByObs.get(id)!.has('common')).toBe(false);
    }
    expect(topicsByObs.get(1)!.has('distinctive')).toBe(true);
  });

  it('respects MAX_TEXT_CHARS=600 truncation', () => {
    const padding = 'padding '.repeat(80); // ~640 chars
    const obs = [
      mkObs(1, 'p', 'short', `${padding} uniqueterm`),
      mkObs(2, 'p', 'decoy', 'other content'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);
    expect(topicsByObs.get(1)!.has('uniqueterm')).toBe(false);
  });
});
