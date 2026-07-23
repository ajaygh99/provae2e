import {
  ContractRegistry,
  detectProductionDrift,
  generateComplianceReport,
  parseOpenApiContract,
  parsePactContract,
  validateApiExchange
} from '../../src/core/contract-testing.js';

const openApi = `
openapi: 3.0.3
info:
  title: Users API
  version: 2.1.0
paths:
  /users/{id}:
    get:
      operationId: getUser
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                required: [id, role]
                properties:
                  id: { type: integer }
                  role: { type: string, enum: [admin, user] }
        '404':
          content:
            application/json:
              schema:
                type: object
                required: [message]
                properties:
                  message: { type: string }
  /users:
    post:
      operationId: createUser
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: { type: string }
                tags:
                  type: array
                  items: { type: string }
      responses:
        '201':
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id: { type: integer }
`;

const pact = JSON.stringify({
  consumer: { name: 'web' }, provider: { name: 'users' },
  metadata: { pactSpecification: { version: '4.0' } },
  interactions: [{ description: 'list users', request: { method: 'GET', path: '/users' }, response: { status: 200, body: [{ id: 1, active: true }] } }]
});

describe('Golden Thread contract testing', () => {
  let registry: ContractRegistry;

  beforeEach(() => {
    registry = new ContractRegistry();
    registry.register(parseOpenApiContract(openApi));
  });

  describe('contract registry and ingestion', () => {
    it('registers a versioned OpenAPI document', () => {
      const contract = registry.list()[0];
      expect(contract.id).toBe('openapi:users-api:2.1.0');
      expect(contract.version).toBe('2.1.0');
      expect(contract.source).toBe('openapi');
      expect(contract.operations).toHaveLength(2);
      expect(contract.registeredAt).toBeTruthy();
    });

    it('supports a source-controlled version override', () => {
      expect(parseOpenApiContract(openApi, 'git-abc123').version).toBe('git-abc123');
    });

    it('rejects malformed OpenAPI documents', () => {
      expect(() => parseOpenApiContract('info: { title: bad }')).toThrow('openapi and paths are required');
    });

    it('parses Pact provider, consumer and interaction data', () => {
      const contract = parsePactContract(pact);
      expect(contract.id).toBe('pact:web:users:4.0');
      expect(contract.operations[0]).toMatchObject({ provider: 'users', consumer: 'web', method: 'GET', path: '/users' });
      expect(contract.operations[0].responseSchemas[200]).toMatchObject({ type: 'array' });
    });

    it('rejects Pact documents without interactions', () => {
      expect(() => parsePactContract('{"consumer":{"name":"web"}}')).toThrow('interactions are required');
    });

    it('requires registry identifiers and versions', () => {
      expect(() => registry.register({ id: '', name: 'x', version: '1', source: 'openapi', operations: [] })).toThrow('id is required');
      expect(() => registry.register({ id: 'x', name: 'x', version: '', source: 'openapi', operations: [] })).toThrow('version is required');
    });

    it('retrieves contracts by id', () => {
      expect(registry.get('openapi:users-api:2.1.0')?.name).toBe('Users API');
      expect(registry.get('missing')).toBeUndefined();
    });
  });

  describe('E2E request linking and validation', () => {
    it('links parameterized URLs including query strings', () => {
      const match = registry.findOperation('get', '/users/42?include=team');
      expect(match?.operation.id).toBe('getUser');
    });

    it('accepts a compliant request and response', () => {
      const result = validateApiExchange(registry, { method: 'POST', path: '/users', requestBody: { name: 'Ada', tags: ['qa'] }, status: 201, responseBody: { id: 7 } });
      expect(result).toEqual(expect.objectContaining({ compliant: true, operationId: 'createUser', errors: [] }));
    });

    it('reports a missing request field with its path', () => {
      const result = validateApiExchange(registry, { method: 'POST', path: '/users', requestBody: {}, status: 201, responseBody: { id: 7 } });
      expect(result.errors).toContain('request.body.name (missing required field)');
    });

    it('validates nested array item types', () => {
      const result = validateApiExchange(registry, { method: 'POST', path: '/users', requestBody: { name: 'Ada', tags: ['qa', 2] }, status: 201, responseBody: { id: 7 } });
      expect(result.errors).toContain('request.body.tags[1] (expected string, got number)');
    });

    it('validates integer and enum constraints', () => {
      const result = validateApiExchange(registry, { method: 'GET', path: '/users/7', status: 200, responseBody: { id: 1.5, role: 'owner' } });
      expect(result.errors).toEqual(expect.arrayContaining(['response.body.id (expected integer)', 'response.body.role (value is not in enum)']));
    });

    it('reports an undocumented status code', () => {
      expect(validateApiExchange(registry, { method: 'GET', path: '/users/7', status: 500 }).errors).toContain('response.status (undocumented status 500)');
    });

    it('reports an unmatched API call', () => {
      const result = validateApiExchange(registry, { method: 'GET', path: '/orders', status: 200 });
      expect(result).toEqual({ compliant: false, errors: ['No contract operation matches GET /orders'] });
    });

    it('validates documented error responses', () => {
      expect(validateApiExchange(registry, { method: 'GET', path: '/users/nope', status: 404, responseBody: { message: 'missing' } }).compliant).toBe(true);
    });
  });

  describe('production drift and alerts', () => {
    it('detects schema drift and notifies the team', async () => {
      const notified: string[] = [];
      const single = new ContractRegistry();
      single.register({ id: 'one', source: 'openapi', name: 'one', version: '1', operations: [{ id: 'health', method: 'GET', path: '/health', responseSchemas: { 200: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } } }] });
      const alerts = await detectProductionDrift({ registry: single, baseUrl: 'https://api.example.test/',
        fetcher: async (): Promise<{ status: number; json(): Promise<unknown> }> => ({ status: 200, json: async () => ({ ok: 'wrong' }) }),
        notify: alert => { notified.push(alert.operationId); }
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].errors).toContain('response.body.ok (expected boolean, got string)');
      expect(notified).toEqual(['health']);
    });

    it('reports production probe failures safely', async () => {
      const single = new ContractRegistry();
      single.register({ id: 'one', source: 'openapi', name: 'one', version: '1', operations: [{ id: 'health', method: 'GET', path: '/health', responseSchemas: { 200: { type: 'object' } } }] });
      const alerts = await detectProductionDrift({ registry: single, baseUrl: 'https://api.test', fetcher: async () => { throw new Error('offline'); } });
      expect(alerts[0].errors).toEqual(['Production probe failed: offline']);
    });

    it('returns no alert for a compliant production response', async () => {
      const single = new ContractRegistry();
      single.register({ id: 'one', source: 'openapi', name: 'one', version: '1', operations: [{ id: 'health', method: 'GET', path: '/health', responseSchemas: { 200: { type: 'object' } } }] });
      await expect(detectProductionDrift({ registry: single, baseUrl: 'https://api.test', fetcher: async (): Promise<{ status: number; json(): Promise<unknown> }> => ({ status: 200, json: async () => ({ ok: true }) }) })).resolves.toEqual([]);
    });

    it('skips parameterized endpoints that cannot be probed without test data', async () => {
      const fetcher = jest.fn();
      await detectProductionDrift({ registry, baseUrl: 'https://api.test', fetcher });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('compliance reporting', () => {
    it('reports the percentage of compliant requests', () => {
      const report = generateComplianceReport(registry, [
        { method: 'GET', path: '/users/1', status: 200, responseBody: { id: 1, role: 'admin' } },
        { method: 'GET', path: '/users/2', status: 200, responseBody: { id: 'bad', role: 'user' } }
      ]);
      expect(report).toMatchObject({ total: 2, compliant: 1, nonCompliant: 1, compliancePercentage: 50 });
      expect(report.summary).toBe('50% of requests comply with published contract');
    });

    it('reports 100 percent when there are no requests', () => {
      expect(generateComplianceReport(registry, []).summary).toBe('100% of requests comply with published contract');
    });
  });
});
