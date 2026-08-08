/** Safe, deterministic OpenAPI execution without an LLM dependency. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseOpenApiContract,
  ContractRegistry,
  validateApiExchange,
  validateJsonSchema,
  type ContractOperation,
  type JsonSchema
} from './contract-testing.js';
import { runApiTest, type ApiRunResult, type HttpMethod } from '../runners/api-runner.js';

export interface OpenApiRunOptions {
  specPath: string;
  baseUrl: string;
  allowWrite?: boolean;
  headers?: Record<string, string>;
  pathParams?: Record<string, string>;
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

function resolveOperationPath(template: string, values: Record<string, string> = {}): string | undefined {
  let missing = false;
  const resolved = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return encodeURIComponent(value);
  });
  return missing ? undefined : resolved;
}

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
    const resolvedPath = resolveOperationPath(operation.path, options.pathParams);
    if (!resolvedPath) {
      results.push({ operationId: operation.id, method: operation.method, path: operation.path, status: 'SKIP', reason: 'Path parameters require --path-params values' });
      continue;
    }
    if (WRITE_METHODS.has(operation.method) && !options.allowWrite) {
      results.push({ operationId: operation.id, method: operation.method, path: operation.path, status: 'SKIP', reason: 'Write operation requires --allow-write' });
      continue;
    }
    const body = exampleFromSchema(operation.requestSchema);
    const requestErrors = operation.requestSchema
      ? validateJsonSchema(body, operation.requestSchema, 'request.body')
      : [];
    if (requestErrors.length) {
      results.push({
        operationId: operation.id,
        method: operation.method,
        path: resolvedPath,
        status: 'FAIL',
        reason: `Generated request failed schema validation: ${requestErrors.join('; ')}`
      });
      continue;
    }
    const run = await runApiTest({
      url: `${options.baseUrl.replace(/\/$/, '')}${resolvedPath}`,
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
      path: resolvedPath,
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

export interface OpenApiGenerateOptions {
  specPath: string;
  baseUrl: string;
  outputDir: string;
  allowWrite?: boolean;
  pathParams?: Record<string, string>;
}

/** Generates readable Playwright API tests without executing the API. */
export async function generateOpenApiTests(options: OpenApiGenerateOptions): Promise<string[]> {
  const contract = parseOpenApiContract(await readFile(options.specPath, 'utf-8'));
  await mkdir(options.outputDir, { recursive: true });
  const files: string[] = [];
  for (const operation of contract.operations) {
    const fileName = `${operation.method.toLowerCase()}-${operation.id}`
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filePath = path.join(options.outputDir, `${fileName}.spec.ts`);
    const resolvedPath = resolveOperationPath(operation.path, options.pathParams);
    const isWrite = WRITE_METHODS.has(operation.method);
    const skipReason = !resolvedPath
      ? 'Provide required path parameters before enabling this test'
      : isWrite && !options.allowWrite
        ? 'Write operation requires explicit approval'
        : undefined;
    const body = exampleFromSchema(operation.requestSchema);
    const requestLine = body === undefined
      ? `request.${operation.method.toLowerCase()}(url)`
      : `request.${operation.method.toLowerCase()}(url, { data: ${JSON.stringify(body, null, 2)} })`;
    const source = `import { test, expect } from '@playwright/test';

test${skipReason ? '.skip' : ''}(${JSON.stringify(`${operation.method} ${operation.path}`)}, async ({ request }) => {
  // ${skipReason ?? 'Generated deterministically from the OpenAPI contract.'}
  const url = ${JSON.stringify(`${options.baseUrl.replace(/\/$/, '')}${resolvedPath ?? operation.path}`)};
  const response = await ${requestLine};
  expect(response.status()).toBe(${expectedStatus(operation)});
});
`;
    try {
      await writeFile(filePath, source, { encoding: 'utf-8', flag: 'wx' });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'EEXIST') throw new Error(`Refusing to overwrite generated test: ${filePath}`);
      throw error;
    }
    files.push(filePath);
  }
  return files;
}
