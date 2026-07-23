import {
  GraphQueryCache,
  KnowledgeGraphQueryApi,
  KnowledgeGraphQueryEngine
} from '../../src/core/knowledge-graph-query.js';

async function graph(): Promise<KnowledgeGraphQueryEngine> {
  const engine = await KnowledgeGraphQueryEngine.create();
  [
    { id: 'req-1', type: 'requirement' as const, name: 'Login requirement', status: 'active' },
    { id: 'code-1', type: 'code' as const, name: 'auth.ts', properties: { changes: 12 } },
    { id: 'test-1', type: 'test' as const, name: 'login test', properties: { duration: 200 } },
    { id: 'test-2', type: 'test' as const, name: 'edge test', properties: { duration: 100 } },
    { id: 'service-1', type: 'service' as const, name: 'identity' },
    { id: 'incident-1', type: 'incident' as const, name: 'login outage', properties: { impact: 40 } }
  ].forEach((vertex) => engine.addVertex(vertex));
  engine.addEdge({ source: 'req-1', target: 'code-1', relation: 'implemented-by' });
  engine.addEdge({ source: 'code-1', target: 'test-1', relation: 'covered-by' });
  engine.addEdge({ source: 'req-1', target: 'test-2', relation: 'covered-by' });
  engine.addEdge({ source: 'test-1', target: 'incident-1', relation: 'detected' });
  engine.addEdge({ source: 'service-1', target: 'incident-1', relation: 'affected-by' });
  return engine;
}

describe('KnowledgeGraphQueryEngine', () => {
  test('validates cache configuration', () => {
    expect(() => new GraphQueryCache(0)).toThrow('capacity');
    expect(() => new GraphQueryCache(1, 0)).toThrow('TTL');
  });

  test('evicts the least recently used cache entry', () => {
    const cache = new GraphQueryCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
  });

  test('expires cache entries', () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValueOnce(10);
    const cache = new GraphQueryCache(2, 5);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
    jest.restoreAllMocks();
  });

  test('requires valid vertices and edges', async () => {
    const engine = await KnowledgeGraphQueryEngine.create();
    expect(() => engine.addVertex({ id: '', type: 'test', name: 'x' })).toThrow('id');
    expect(() => engine.addVertex({ id: 'x', type: 'test', name: '' })).toThrow('name');
    expect(() => engine.addEdge({ source: 'missing', target: 'also-missing', relation: 'x' })).toThrow('Source');
    engine.addVertex({ id: 'x', type: 'test', name: 'x' });
    expect(() => engine.addEdge({ source: 'x', target: 'missing', relation: 'x' })).toThrow('Target');
    expect(() => engine.addEdge({ source: 'x', target: 'x', relation: '' })).toThrow('relation');
  });

  test('gets stored vertex metadata', async () => {
    const engine = await graph();
    expect(engine.getVertex('req-1')).toMatchObject({ name: 'Login requirement', status: 'active' });
    expect(engine.getVertex('missing')).toBeUndefined();
  });

  test('answers what tests cover a requirement across direct and indirect paths', async () => {
    const engine = await graph();
    expect(engine.answer({ kind: 'tests-for-requirement', requirementId: 'req-1' })
      .map((item) => item.id).sort()).toEqual(['test-1', 'test-2']);
  });

  test('answers what code changed in a test when code is linked forward', async () => {
    const engine = await graph();
    engine.addEdge({ source: 'test-2', target: 'code-1', relation: 'exercises' });
    expect(engine.answer({ kind: 'code-for-test', testId: 'test-2' })[0]).toMatchObject({ id: 'code-1' });
  });

  test('answers what incidents affect a service', async () => {
    const engine = await graph();
    expect(engine.answer({ kind: 'incidents-for-service', serviceId: 'service-1' })[0])
      .toMatchObject({ id: 'incident-1' });
  });

  test('finds requirement to code to test to incident path', async () => {
    const engine = await graph();
    const paths = engine.findPaths('req-1', { targetType: 'incident', maxDepth: 4 });
    expect(paths[0].vertices.map((vertex) => vertex.type))
      .toEqual(['requirement', 'code', 'test', 'incident']);
  });

  test('guards traversal depth and missing starts', async () => {
    const engine = await graph();
    expect(() => engine.findPaths('req-1', { maxDepth: 0 })).toThrow('maxDepth');
    expect(() => engine.findPaths('missing', { maxDepth: 2 })).toThrow('not found');
  });

  test('protects traversal from cycles', async () => {
    const engine = await graph();
    engine.addEdge({ source: 'test-1', target: 'req-1', relation: 'cycle' });
    expect(engine.findPaths('req-1', { targetType: 'incident', maxDepth: 10 })).toHaveLength(1);
  });

  test('supports count and statistical queries', async () => {
    const engine = await graph();
    expect(engine.aggregate({ operation: 'count', vertexType: 'test' })).toBe(2);
    expect(engine.aggregate({ operation: 'average', vertexType: 'test', property: 'duration' })).toBe(150);
    expect(engine.aggregate({ operation: 'minimum', vertexType: 'test', property: 'duration' })).toBe(100);
    expect(engine.aggregate({ operation: 'maximum', vertexType: 'test', property: 'duration' })).toBe(200);
    expect(engine.aggregate({ operation: 'average', vertexType: 'service', property: 'duration' })).toBe(0);
    expect(() => engine.aggregate({ operation: 'average' })).toThrow('Property');
  });
});

describe('KnowledgeGraphQueryApi', () => {
  test('exposes business questions at POST /api/graph/query', async () => {
    const api = new KnowledgeGraphQueryApi(await graph());
    const response = api.handle({
      method: 'POST',
      path: '/api/graph/query',
      body: { query: 'testsForRequirement', variables: { requirementId: 'req-1' } }
    });
    expect(response.status).toBe(200);
    expect(response.body['data']).toHaveLength(2);
  });

  test.each([
    ['codeForTest', { testId: 'test-2' }],
    ['incidentsForService', { serviceId: 'service-1' }],
    ['path', { startId: 'req-1', targetType: 'incident' }],
    ['aggregate', { operation: 'count', vertexType: 'test' }]
  ])('supports query %s', async (query, variables) => {
    const engine = await graph();
    engine.addEdge({ source: 'test-2', target: 'code-1', relation: 'exercises' });
    const response = new KnowledgeGraphQueryApi(engine).handle({
      method: 'POST', path: '/api/graph/query', body: { query, variables }
    });
    expect(response.status).toBe(200);
  });

  test('returns clear client errors', async () => {
    const api = new KnowledgeGraphQueryApi(await graph());
    expect(api.handle({ method: 'GET', path: '/api/graph/query' }).status).toBe(404);
    expect(api.handle({ method: 'POST', path: '/api/graph/query', body: {} }).status).toBe(400);
    expect(api.handle({
      method: 'POST', path: '/api/graph/query', body: { query: 'unknown' }
    }).body['error']).toContain('Unsupported');
    expect(api.handle({
      method: 'POST', path: '/api/graph/query',
      body: { query: 'testsForRequirement', variables: {} }
    }).body['error']).toContain('requirementId');
  });
});
