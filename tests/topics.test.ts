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

  it('caps topics at TOP_K=5', () => {
    const obs = [
      mkObs(1, 'p', 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'),
      mkObs(2, 'p', 'unrelated content here'),
    ];
    const { topicsByObs } = extractDomainTopics(obs);
    expect(topicsByObs.get(1)!.size).toBeLessThanOrEqual(5);
  });

  it('filters out short tokens and stopwords', () => {
    const obs = [mkObs(1, 'p', 'the and but real-content here')];
    const { topicsByObs } = extractDomainTopics(obs);
    const topics = topicsByObs.get(1)!;
    expect(topics.has('the')).toBe(false);
    expect(topics.has('and')).toBe(false);
    expect(topics.has('but')).toBe(false);
  });
});
