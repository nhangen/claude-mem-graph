import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph.js';
import type { Observation, Session } from '../src/types.js';

function mkObs(over: Partial<Observation> & Pick<Observation, 'id' | 'createdAt'>): Observation {
  return {
    sessionId: over.sessionId ?? 'sess-x',
    project: 'p',
    type: 'decision',
    title: '',
    subtitle: '',
    narrative: '',
    text: '',
    facts: '',
    concepts: [],
    filesRead: [],
    filesModified: [],
    promptNumber: 1,
    relevanceCount: 0,
    metadata: {},
    ...over,
  };
}

function supersedesTargets(observations: Observation[], fromId: number): string[] {
  const sessions: Session[] = [];
  const graph = buildGraph(observations, sessions);
  const edges = graph.filterOutEdges(`obs:${fromId}`, (_e, attrs) => attrs.type === 'supersedes');
  return edges.map(e => graph.target(e));
}

describe('addSupersedesEdges topic-fallback gate', () => {
  it('fires when both obs have zero non-stopword concepts, share a file, and topics overlap >= 0.5', () => {
    // Third decoy obs prevents shared tokens from being suppressed by the
    // df===N guard in extractDomainTopics (they need to be NOT in every doc).
    const observations: Observation[] = [
      mkObs({
        id: 1, createdAt: 1000,
        title: 'hubspot lists migration approach',
        concepts: ['how-it-works', 'pattern'],
        filesModified: ['src/HubSpot/Client.php'],
      }),
      mkObs({
        id: 2, createdAt: 2000,
        title: 'hubspot lists migration revised',
        concepts: ['gotcha', 'best-practice'],
        filesModified: ['src/HubSpot/Client.php'],
      }),
      mkObs({
        id: 99, createdAt: 500, type: 'discovery',
        title: 'unrelated stripe webhook signature',
        concepts: ['stripe'],
        filesRead: ['src/Stripe/Webhook.php'],
      }),
    ];
    expect(supersedesTargets(observations, 2)).toContain('obs:1');
  });

  it('does not fire when obs share no file (file-overlap gate)', () => {
    const observations: Observation[] = [
      mkObs({
        id: 1, createdAt: 1000,
        title: 'HubSpot v3 lists migration approach selection',
        concepts: ['how-it-works'],
        filesModified: ['src/A.php'],
      }),
      mkObs({
        id: 2, createdAt: 2000,
        title: 'HubSpot v3 lists migration revised batch endpoint',
        concepts: ['gotcha'],
        filesModified: ['src/B.php'],
      }),
    ];
    expect(supersedesTargets(observations, 2)).not.toContain('obs:1');
  });

  it('does not fire when only one side has filtered concepts (strict-zero gate)', () => {
    const observations: Observation[] = [
      mkObs({
        id: 1, createdAt: 1000,
        title: 'HubSpot v3 lists migration approach',
        concepts: ['how-it-works'],
        filesModified: ['src/Shared.php'],
      }),
      mkObs({
        id: 2, createdAt: 2000,
        title: 'HubSpot v3 lists migration revised',
        concepts: ['gotcha', 'real-domain-concept'],
        filesModified: ['src/Shared.php'],
      }),
    ];
    expect(supersedesTargets(observations, 2)).not.toContain('obs:1');
  });

  it('does not fire when topic overlap is below 0.5', () => {
    const observations: Observation[] = [
      mkObs({
        id: 1, createdAt: 1000,
        title: 'alpha beta gamma delta epsilon',
        concepts: ['how-it-works'],
        filesModified: ['src/Shared.php'],
      }),
      mkObs({
        id: 2, createdAt: 2000,
        title: 'zeta theta iota kappa lambda',
        concepts: ['gotcha'],
        filesModified: ['src/Shared.php'],
      }),
    ];
    expect(supersedesTargets(observations, 2)).not.toContain('obs:1');
  });

  it('primary concept-overlap branch still fires when both obs have real concepts (regression)', () => {
    const observations: Observation[] = [
      mkObs({
        id: 1, createdAt: 1000,
        concepts: ['hubspot', 'api-migration', 'contact-lists'],
      }),
      mkObs({
        id: 2, createdAt: 2000,
        concepts: ['hubspot', 'api-migration', 'contact-lists'],
      }),
    ];
    expect(supersedesTargets(observations, 2)).toContain('obs:1');
  });

  it('does not cross projects even when topics + files would otherwise match', () => {
    const observations: Observation[] = [
      mkObs({
        id: 1, createdAt: 1000, project: 'a',
        title: 'HubSpot v3 lists migration approach',
        concepts: ['how-it-works'],
        filesModified: ['src/Shared.php'],
      }),
      mkObs({
        id: 2, createdAt: 2000, project: 'b',
        title: 'HubSpot v3 lists migration revised',
        concepts: ['gotcha'],
        filesModified: ['src/Shared.php'],
      }),
    ];
    expect(supersedesTargets(observations, 2)).not.toContain('obs:1');
  });
});
