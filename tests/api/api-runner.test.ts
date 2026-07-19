/**
 * API Runner Tests
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runApiTest, validateSchema } from '../../src/runners/api-runner';

jest.setTimeout(30000);

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

describe('validateSchema', () => {
  it('returns no errors when the body matches the schema', () => {
    const errors = validateSchema({ id: 1, name: 'Ada', active: true }, {
      id: 'number',
      name: 'string',
      active: 'boolean'
    });
    expect(errors).toEqual([]);
  });

  it('reports a missing field', () => {
    const errors = validateSchema({ id: 1 }, { id: 'number', name: 'string' });
    expect(errors).toEqual(['Missing field "name"']);
  });

  it('reports a wrong-type field', () => {
    const errors = validateSchema({ id: '1' }, { id: 'number' });
    expect(errors).toEqual(['Field "id" expected type "number" but got "string"']);
  });

  it('reports a non-object body as invalid', () => {
    expect(validateSchema(null, { id: 'number' })).toEqual(['Response body is not a JSON object']);
    expect(validateSchema([1, 2], { id: 'number' })).toEqual(['Response body is not a JSON object']);
    expect(validateSchema(undefined, { id: 'number' })).toEqual(['Response body is not a JSON object']);
  });
});

describe('API Runner', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      void (async (): Promise<void> => {
        const bodyText = await readBody(req);
        const url = req.url ?? '';

        if (url === '/users/1' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 1, name: 'Ada', active: true }));
          return;
        }

        if (url === '/echo' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ method: req.method, received: bodyText ? JSON.parse(bodyText) : null }));
          return;
        }

        if (url === '/not-found') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        if (url === '/slow') {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }, 150);
          return;
        }

        if (url === '/graphql') {
          const parsed = bodyText ? (JSON.parse(bodyText) as { query: string; variables?: Record<string, unknown> }) : { query: '' };
          if (parsed.query.includes('brokenQuery')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'field "brokenQuery" does not exist' }] }));
            return;
          }
          if (parsed.query.includes('emptyErrorsQuery')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: { user: { id: 1, name: 'Ada' } }, errors: [] }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { user: { id: 1, name: 'Ada' } } }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown route' }));
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('passes a GET request and validates the schema', async () => {
    const result = await runApiTest({
      url: `${baseUrl}/users/1`,
      schema: { id: 'number', name: 'string', active: 'boolean' }
    });

    expect(result.status).toBe('PASS');
    expect(result.method).toBe('GET');
    expect(result.statusCode).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.responseSummary).toContain('Ada');
  });

  it.each(['POST', 'PUT', 'DELETE'] as const)('passes a %s request with a body', async (method): Promise<void> => {
    const result = await runApiTest({
      url: `${baseUrl}/echo`,
      method,
      body: { hello: 'world' }
    });

    expect(result.status).toBe('PASS');
    expect(result.method).toBe(method);
    expect(result.responseSummary).toContain('hello');
  });

  it('fails without throwing on a status code mismatch', async () => {
    const result = await runApiTest({ url: `${baseUrl}/not-found` });

    expect(result.status).toBe('FAIL');
    expect(result.statusCode).toBe(404);
    expect(result.error).toBe('Expected status 200 but got 404');
  });

  it('fails when response time exceeds the configured threshold', async () => {
    const result = await runApiTest({ url: `${baseUrl}/slow`, maxResponseTimeMs: 10 });

    expect(result.status).toBe('FAIL');
    expect(result.error).toContain('exceeded threshold');
  });

  it('fails without throwing when the schema does not match', async () => {
    const result = await runApiTest({
      url: `${baseUrl}/users/1`,
      schema: { id: 'number', name: 'string', email: 'string' }
    });

    expect(result.status).toBe('FAIL');
    expect(result.error).toContain('Missing field "email"');
  });

  it('fails without throwing when the host is unreachable', async () => {
    const result = await runApiTest({ url: 'http://127.0.0.1:1' });

    expect(result.status).toBe('FAIL');
    expect(result.error).toBeDefined();
    expect(result.statusCode).toBeUndefined();
  });

  it('passes a GraphQL query and validates the data field', async () => {
    const result = await runApiTest({
      url: `${baseUrl}/graphql`,
      graphql: { query: 'query { user { id name } }' },
      schema: { user: 'object' }
    });

    expect(result.status).toBe('PASS');
    expect(result.method).toBe('POST');
    expect(result.responseSummary).toContain('Ada');
  });

  it('fails without throwing when the GraphQL response contains a non-empty errors array', async () => {
    const result = await runApiTest({
      url: `${baseUrl}/graphql`,
      graphql: { query: 'query { brokenQuery }' }
    });

    expect(result.status).toBe('FAIL');
    expect(result.error).toContain('GraphQL response contained errors');
  });

  it('passes when the GraphQL response has an empty errors array', async () => {
    const result = await runApiTest({
      url: `${baseUrl}/graphql`,
      graphql: { query: 'query { emptyErrorsQuery }' },
      schema: { user: 'object' }
    });

    expect(result.status).toBe('PASS');
    expect(result.error).toBeUndefined();
  });
});
