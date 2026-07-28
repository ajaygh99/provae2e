import { runApiTest } from '../../src/runners/api-runner';
import { exampleFromSchema, runOpenApiContract } from '../../src/core/openapi-runner';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../src/runners/api-runner', () => ({ runApiTest: jest.fn() }));
const mockedRun = runApiTest as jest.MockedFunction<typeof runApiTest>;

describe('OpenAPI runner', () => {
  let directory: string;
  let specPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'prova-openapi-'));
    specPath = path.join(directory, 'openapi.yaml');
    await writeFile(specPath, `openapi: 3.0.3
info: { title: Example, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: health
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [status]
                properties:
                  status: { type: string }
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
      responses: { "201": { description: created } }
`);
    mockedRun.mockResolvedValue({
      status: 'PASS', url: 'https://api.example/health', method: 'GET',
      statusCode: 200, durationMs: 5, responseBody: { status: 'ok' }
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('executes reads and skips writes by default', async () => {
    const results = await runOpenApiContract({ specPath, baseUrl: 'https://api.example' });
    expect(results.map(result => result.status)).toEqual(['PASS', 'SKIP']);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it('allows explicitly approved writes with deterministic bodies', async () => {
    mockedRun.mockResolvedValueOnce({
      status: 'PASS', url: 'https://api.example/health', method: 'GET',
      statusCode: 200, durationMs: 5, responseBody: { status: 'ok' }
    }).mockResolvedValueOnce({
      status: 'PASS', url: 'https://api.example/users', method: 'POST',
      statusCode: 201, durationMs: 5
    });
    const results = await runOpenApiContract({ specPath, baseUrl: 'https://api.example', allowWrite: true });
    expect(results.every(result => result.status === 'PASS')).toBe(true);
    expect(mockedRun).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'POST', body: { name: 'prova-test' } }));
  });

  it('generates deterministic required fields only', () => {
    expect(exampleFromSchema({
      type: 'object', required: ['enabled'], properties: {
        enabled: { type: 'boolean' }, ignored: { type: 'string' }
      }
    })).toEqual({ enabled: true });
  });
});
