import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runOpenApiContract } from '../../src/core/openapi-runner';

describe('OpenAPI five-endpoint live evidence', () => {
  let server: Server;
  let directory: string;
  let specPath: string;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && request.url === '/health') response.end('{"status":"ok"}');
      else if (request.method === 'GET' && request.url === '/users') response.end('[]');
      else if (request.method === 'GET' && request.url === '/users/42') response.end('{"id":"42"}');
      else if (request.method === 'POST' && request.url === '/orders') {
        response.statusCode = 201;
        response.end('{"id":"order-1"}');
      } else if (request.method === 'DELETE' && request.url === '/orders/99') {
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end('{"error":"not found"}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    directory = await mkdtemp(path.join(os.tmpdir(), 'prova-openapi-e2e-'));
    specPath = path.join(directory, 'readiness.yaml');
    await writeFile(specPath, `openapi: 3.0.3
info: { title: Phase 4 Readiness, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: health
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: object, required: [status], properties: { status: { type: string } } } } } }
  /users:
    get:
      operationId: listUsers
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: array, items: { type: object } } } } }
  /users/{userId}:
    get:
      operationId: getUser
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: object, required: [id], properties: { id: { type: string } } } } } }
  /orders:
    post:
      operationId: createOrder
      responses:
        "201": { description: created, content: { application/json: { schema: { type: object, required: [id], properties: { id: { type: string } } } } } }
  /orders/{orderId}:
    delete:
      operationId: deleteOrder
      responses: { "204": { description: deleted } }
`);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it('passes reads, resolves paths, and blocks writes by default', async () => {
    const results = await runOpenApiContract({
      specPath, baseUrl, pathParams: { userId: '42', orderId: '99' }
    });
    expect(results.map(result => result.status)).toEqual(['PASS', 'PASS', 'PASS', 'SKIP', 'SKIP']);
  });

  it('passes all five operations after explicit write approval', async () => {
    const results = await runOpenApiContract({
      specPath, baseUrl, pathParams: { userId: '42', orderId: '99' }, allowWrite: true
    });
    expect(results).toHaveLength(5);
    expect(results.every(result => result.status === 'PASS')).toBe(true);
  });
});
