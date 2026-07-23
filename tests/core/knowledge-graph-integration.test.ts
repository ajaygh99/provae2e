import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  KnowledgeGraphIntegration,
  type KnowledgeGraphDataset
} from '../../src/core/knowledge-graph-integration';

const dataset: KnowledgeGraphDataset = {
  nodes: [
    { id: 'PROJ-123', type: 'requirement', label: 'Checkout works' },
    { id: 'PROJ-404', type: 'requirement', label: 'Refund works' },
    { id: 'test-checkout', type: 'test', label: 'checkout.spec.ts' },
    { id: 'commit-1', type: 'commit', label: 'abc123', timestamp: '2026-01-01T00:00:00Z' },
    { id: 'run-1', type: 'test-run', label: 'Run 1', status: 'PASS', timestamp: '2026-01-02T00:00:00Z' },
    { id: 'deploy-1', type: 'deployment', label: 'Production', timestamp: '2026-01-03T00:00:00Z' },
    { id: 'incident-1', type: 'incident', label: 'Checkout outage', timestamp: '2026-01-04T00:00:00Z' }
  ],
  edges: [
    { from: 'PROJ-123', to: 'test-checkout', relationship: 'covered-by' },
    { from: 'test-checkout', to: 'commit-1', relationship: 'changed-by' },
    { from: 'test-checkout', to: 'run-1', relationship: 'verified-by' },
    { from: 'commit-1', to: 'deploy-1', relationship: 'deployed-as' },
    { from: 'deploy-1', to: 'incident-1', relationship: 'caused' },
    { from: 'PROJ-404', to: 'incident-1', relationship: 'related-to' }
  ]
};

describe('KnowledgeGraphIntegration', () => {
  const graph = new KnowledgeGraphIntegration(dataset);

  it('shows linked tests for a requirement and commits for a test', () => {
    expect(graph.testsForRequirement('PROJ-123').nodes.map(node => node.id)).toEqual(['test-checkout']);
    expect(graph.commitsForTest('test-checkout').nodes.map(node => node.id)).toEqual(['commit-1']);
  });

  it('returns the full bidirectional incident chain', () => {
    const chain = graph.incidentChain('incident-1');
    expect(chain.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      'deploy-1', 'commit-1', 'test-checkout', 'run-1', 'PROJ-123', 'PROJ-404'
    ]));
  });

  it('shows latest run, results, commits, incidents, and a timeline', () => {
    const history = graph.testHistory('test-checkout');
    expect(history.lastRun).toMatchObject({ id: 'run-1', status: 'PASS' });
    expect(history.commits.map(node => node.id)).toEqual(['commit-1']);
    expect(history.incidents.map(node => node.id)).toEqual(['incident-1']);
    expect(history.timeline.at(-1)?.id).toBe('incident-1');
  });

  it('suggests uncovered requirements with incident-aware priority', () => {
    expect(graph.coverageSuggestions()).toEqual([{
      requirementId: 'PROJ-404',
      requirement: 'Refund works',
      suggestion: 'Create a test covering Refund works',
      priority: 'high'
    }]);
  });

  it('loads JSON and validates missing, duplicate, and dangling data', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-graph-'));
    const file = path.join(directory, 'graph.json');
    await writeFile(file, JSON.stringify(dataset));
    expect((await KnowledgeGraphIntegration.fromFile(file)).testsForRequirement('PROJ-123').nodes).toHaveLength(1);
    await expect(KnowledgeGraphIntegration.fromFile(path.join(directory, 'missing.json'))).rejects.toThrow('Unable to load');
    expect(() => new KnowledgeGraphIntegration({ nodes: [], edges: [{ from: 'a', to: 'b', relationship: 'related-to' }] })).toThrow('unknown node');
    expect(() => new KnowledgeGraphIntegration({ nodes: [dataset.nodes[0]!, dataset.nodes[0]!], edges: [] })).toThrow('Duplicate');
    expect(() => graph.testsForRequirement('missing')).toThrow('not found');
    expect(() => graph.testsForRequirement('test-checkout')).toThrow('must be a requirement');
  });
});
