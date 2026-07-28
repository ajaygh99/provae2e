/** Safe, deterministic OpenAPI execution without an LLM dependency. */
import { readFile } from 'node:fs/promises';
import { parseOpenApiContract, ContractRegistry, validateApiExchange, type ContractOperation, type JsonSchema } from './contract-testing.js';
import { runApiTest, type ApiRunResult, type HttpMethod } from '../runners/api-runner.js';

export interface OpenApiRunOptions {
  specPath: string;
  baseUrl: string;
  allowWrite?: boolean;
  headers?: Record<string, string>;
}

export interface OpenApiOperationResult {
  operationId: string;
  method: string;
  path: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  reason?: string;
  run?: ApiRunResult;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Generates a small deterministic example value from a JSON schema. */
export function exampleFromSchema(schema: JsonSchema | undefined): unknown {
  if (!schema) return undefined;
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {})
        .filter(([key]) => (schema.required ?? []).includes(key))
        .map(([key, child]) => [key, exampleFromSchema(child)]));
    case 'array': return [exampleFromSchema(schema.items)];
    case 'integer':
    case 'number': return 1;
    case 'boolean': return true;
    case 'null': return null;
    case 'string':
    default: return 'prova-test';
  }
}

function expectedStatus(operation: ContractOperation): number {
  return Object.keys(operation.responseSchemas).map(Number).find(status => status >= 200 && status < 300) ?? 200;
}

/** Executes safe OpenAPI operations and validates responses against the contract. */
export async function runOpenApiContract(options: OpenApiRunOptions): Promise<OpenApiOperationResult[]> {
  const content = await readFile(options.specPath, 'utf-8');
  const contract = parseOpenApiContract(content);
  const registry = new ContractRegistry();
  registry.register(contract);
  const results: OpenApiOperationResult[] = [];

  for (const operation of contract.operations) {
    if (operation.path.includes('{')) {
      results.push({ operationId: operation.id, method: operation.method, path: operation.path, status: 'SKIP', reason: 'Path parameters require explicit values' });
      continue;
    }
    if (WRITE_METHODS.has(operation.method) && !options.allowWrite) {
      results.push({ operationId: operation.id, method: operation.method, path: operation.path, status: 'SKIP', reason: 'Write operation requires --allow-write' });
      continue;
    }
    const body = exampleFromSchema(operation.requestSchema);
    const run = await runApiTest({
      url: `${options.baseUrl.replace(/\/$/, '')}${operation.path}`,
      method: operation.method as HttpMethod,
      ...(body === undefined ? {} : { body }),
      headers: options.headers,
      expectedStatus: expectedStatus(operation)
    });
    if (run.status === 'FAIL' || run.statusCode === undefined) {
      results.push({ operationId: operation.id, method: operation.method, path: operation.path, status: 'FAIL', reason: run.error, run });
      continue;
    }
    const validation = validateApiExchange(registry, {
      method: operation.method,
      path: operation.path,
      requestBody: body,
      status: run.statusCode,
      responseBody: run.responseBody
    });
    results.push({
      operationId: operation.id,
      method: operation.method,
      path: operation.path,
      status: validation.compliant ? 'PASS' : 'FAIL',
      ...(validation.compliant ? {} : { reason: validation.errors.join('; ') }),
      run
    });
  }
  return results;
}
