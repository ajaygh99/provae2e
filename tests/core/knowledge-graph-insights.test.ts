import {
  KnowledgeGraphInsightEngine,
  type KnowledgeSubgraph
} from '../../src/core/knowledge-graph-insights';

const graph: KnowledgeSubgraph = {
  changes: [
    {
      id: 'c1', service: 'checkout', files: ['src/checkout/payment.ts'], author: 'Developer A',
      changedAt: '2026-06-01T00:00:00Z', coveredByTestIds: [], deploymentFailed: true
    },
    ...Array.from({ length: 19 }, (_, index) => ({
      id: `c${index + 2}`, service: 'checkout', files: ['src/checkout/cart.ts'], author: 'Developer B',
      changedAt: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      coveredByTestIds: ['fast'], deploymentFailed: false
    }))
  ],
  tests: [
    {
      id: 'flaky', name: 'checkout submits payment', service: 'checkout',
      runs: 100, failures: 1, durationSeconds: 200, coveredFiles: ['src/checkout/payment.ts']
    },
    {
      id: 'fast', name: 'payment unit test', service: 'checkout',
      runs: 100, failures: 0, durationSeconds: 50, coveredFiles: ['src/checkout/payment.ts']
    }
  ],
  incidents: [{
    id: 'inc-1', service: 'checkout', occurredAt: '2026-04-01T00:00:00Z',
    summary: 'checkout payment failed after payment code update',
    mitigation: 'Enable payment circuit breaker'
  }]
};

describe('KnowledgeGraphInsightEngine', () => {
  const engine = new KnowledgeGraphInsightEngine({ now: () : Date => new Date('2026-07-01T00:00:00Z') });

  it('identifies uncovered code and recommends a concrete test', () => {
    const item = engine.analyze(graph).find(insight => insight.type === 'test-gap');
    expect(item).toMatchObject({
      service: 'checkout', impact: 'high', confidence: 0.95,
      title: 'Code in src/checkout/payment.ts was not tested'
    });
    expect(item?.recommendation).toContain('Add a regression test');
  });

  it('predicts service risk from historical deployment failures', () => {
    const item = engine.analyze(graph).find(insight => insight.type === 'risk');
    expect(item?.title).toBe('checkout changes have 5% failure rate');
    expect(item?.reasoning).toContain('1 of 20');
    expect(item?.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('detects a one-percent flaky test and recommends investigation', () => {
    const item = engine.analyze(graph).find(insight => insight.type === 'flaky-test');
    expect(item?.title).toContain('fails 1% of runs and is likely flaky');
    expect(item?.recommendation).toContain('Investigate');
  });

  it('matches incident patterns and recommends historical mitigation', () => {
    const item = engine.analyze(graph).find(insight => insight.type === 'incident');
    expect(item?.title).toContain('3 months ago');
    expect(item?.recommendation).toBe('Enable payment circuit breaker');
    expect(item?.evidenceIds).toContain('inc-1');
  });

  it('compares slow and similar fast tests for optimization', () => {
    const item = engine.analyze(graph).find(insight => insight.type === 'optimization');
    expect(item?.title).toContain('200s');
    expect(item?.title).toContain('50s');
    expect(item?.recommendation).toContain('payment unit test');
  });

  it('identifies the most recent service contributor for collaboration', () => {
    const item = engine.analyze(graph).find(insight => insight.type === 'collaboration');
    expect(item?.title).toBe('Developer A recently changed checkout');
    expect(item?.recommendation).toBe('Contact Developer A for review of checkout changes');
  });

  it('sorts Studio insights by confidence or impact without mutating input', () => {
    const insights = engine.analyze(graph);
    const original = [...insights];
    const byImpact = engine.sort(insights, 'impact');
    expect(byImpact[0].impact).toBe('high');
    expect(insights).toEqual(original);
    expect(insights[0].confidence).toBeGreaterThanOrEqual(insights.at(-1)?.confidence ?? 0);
  });

  it('emits no trend insights when thresholds and evidence are not met', () => {
    const result = engine.analyze({
      changes: [{ ...graph.changes[0], coveredByTestIds: ['t'], deploymentFailed: false }],
      tests: [{ ...graph.tests[0], failures: 0, durationSeconds: 10 }],
      incidents: []
    });
    expect(result.map(item => item.type)).toEqual(['collaboration']);
  });

  it('does not suggest optimization without a faster overlapping test', () => {
    const result = engine.analyze({
      changes: [],
      tests: [{ ...graph.tests[0], coveredFiles: ['unique.ts'] }],
      incidents: []
    });
    expect(result.find(item => item.type === 'optimization')).toBeUndefined();
  });

  it('selects a later contributor when graph changes are chronological', () => {
    const result = engine.analyze({
      changes: [
        { ...graph.changes[0], id: 'old', author: 'Old Author', changedAt: '2026-01-01T00:00:00Z' },
        { ...graph.changes[0], id: 'new', author: 'New Author', changedAt: '2026-06-01T00:00:00Z' }
      ],
      tests: [],
      incidents: []
    });
    expect(result.find(item => item.type === 'collaboration')?.title).toContain('New Author');
  });

  it('validates thresholds and graph data', () => {
    expect(() => new KnowledgeGraphInsightEngine({ flakyRate: 2 })).toThrow('between 0 and 1');
    expect(() => new KnowledgeGraphInsightEngine({ slowTestSeconds: 0 })).toThrow('must be positive');
    expect(() => engine.analyze({ ...graph, tests: [{ ...graph.tests[0], failures: 101 }] }))
      .toThrow('must not exceed');
    expect(() => engine.analyze({ ...graph, changes: [{ ...graph.changes[0], files: [] }] }))
      .toThrow('must not be empty');
  });

  it('rejects invalid clocks and timestamps', () => {
    const badClock = new KnowledgeGraphInsightEngine({ now: () : Date => new Date('invalid') });
    expect(() => badClock.analyze(graph)).toThrow('Current time must be valid');
    expect(() => engine.analyze({ ...graph, incidents: [{ ...graph.incidents[0], occurredAt: 'bad' }] }))
      .toThrow('incident.occurredAt must be valid');
  });
});
