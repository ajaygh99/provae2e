/** Contract testing integration for OpenAPI and Pact artifacts. */
import { parse as parseYaml } from 'yaml';
import { log } from './logger.js';

export type ContractSource = 'openapi' | 'pact';

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  nullable?: boolean;
}

export interface ContractOperation {
  id: string;
  method: string;
  path: string;
  requestSchema?: JsonSchema;
  responseSchemas: Record<number, JsonSchema | undefined>;
  provider?: string;
  consumer?: string;
}

export interface RegisteredContract {
  id: string;
  source: ContractSource;
  name: string;
  version: string;
  operations: ContractOperation[];
  registeredAt: string;
}

export interface ApiExchange {
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody?: unknown;
}

export interface ContractValidationResult {
  compliant: boolean;
  contractId?: string;
  operationId?: string;
  errors: string[];
}

export interface ContractDriftAlert {
  contractId: string;
  operationId: string;
  endpoint: string;
  errors: string[];
  detectedAt: string;
}

export interface ComplianceReport {
  total: number;
  compliant: number;
  nonCompliant: number;
  compliancePercentage: number;
  summary: string;
  results: ContractValidationResult[];
}

export type DriftNotifier = (alert: ContractDriftAlert) => void | Promise<void>;
export type ContractFetch = (url: string, init: { method: string }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

/** Versioned registry for published API contracts. */
export class ContractRegistry {
  private readonly contracts = new Map<string, RegisteredContract>();

  register(contract: Omit<RegisteredContract, 'registeredAt'>): RegisteredContract {
    if (!contract.id.trim()) throw new Error('Contract id is required');
    if (!contract.version.trim()) throw new Error('Contract version is required');
    const registered = { ...contract, registeredAt: new Date().toISOString() };
    this.contracts.set(contract.id, registered);
    log.info('Contract registered', { id: contract.id, source: contract.source, version: contract.version });
    return registered;
  }

  get(id: string): RegisteredContract | undefined {
    return this.contracts.get(id);
  }

  list(): RegisteredContract[] {
    return [...this.contracts.values()];
  }

  findOperation(method: string, requestPath: string): { contract: RegisteredContract; operation: ContractOperation } | undefined {
    for (const contract of this.contracts.values()) {
      const operation = contract.operations.find(candidate =>
        candidate.method.toUpperCase() === method.toUpperCase() && matchPath(candidate.path, requestPath)
      );
      if (operation) return { contract, operation };
    }
    return undefined;
  }
}

/** Parses an OpenAPI YAML or JSON document into a registered contract shape. */
export function parseOpenApiContract(content: string, versionOverride?: string): Omit<RegisteredContract, 'registeredAt'> {
  const doc = parseYaml(content) as Record<string, unknown>;
  const info = asRecord(doc.info);
  const paths = asRecord(doc.paths);
  if (!doc.openapi || !Object.keys(paths).length) throw new Error('Invalid OpenAPI document: openapi and paths are required');

  const operations: ContractOperation[] = [];
  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = asRecord(pathValue);
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (!pathItem[method]) continue;
      const operation = asRecord(pathItem[method]);
      const requestBody = asRecord(operation.requestBody);
      const requestContent = asRecord(requestBody.content);
      const requestMedia = asRecord(requestContent['application/json']);
      const responses = asRecord(operation.responses);
      const responseSchemas: Record<number, JsonSchema | undefined> = {};
      for (const [status, responseValue] of Object.entries(responses)) {
        if (!/^\d{3}$/.test(status)) continue;
        const response = asRecord(responseValue);
        const contentMap = asRecord(response.content);
        const media = asRecord(contentMap['application/json']);
        responseSchemas[Number(status)] = media.schema as JsonSchema | undefined;
      }
      operations.push({
        id: String(operation.operationId || `${method}-${path}`), method: method.toUpperCase(), path,
        requestSchema: requestMedia.schema as JsonSchema | undefined, responseSchemas
      });
    }
  }

  const name = String(info.title || 'OpenAPI Contract');
  const version = versionOverride || String(info.version || doc.openapi);
  return { id: `openapi:${slug(name)}:${version}`, source: 'openapi', name, version, operations };
}

/** Parses a Pact JSON consumer/provider document into a registered contract shape. */
export function parsePactContract(content: string): Omit<RegisteredContract, 'registeredAt'> {
  const doc = JSON.parse(content) as Record<string, unknown>;
  const provider = String(asRecord(doc.provider).name || 'unknown-provider');
  const consumer = String(asRecord(doc.consumer).name || 'unknown-consumer');
  const metadata = asRecord(doc.metadata);
  const version = String(asRecord(metadata.pactSpecification).version || metadata.version || 'unknown');
  const interactions = Array.isArray(doc.interactions) ? doc.interactions : [];
  if (!interactions.length) throw new Error('Invalid Pact document: interactions are required');

  const operations = interactions.map((value, index): ContractOperation => {
    const interaction = asRecord(value);
    const request = asRecord(interaction.request);
    const response = asRecord(interaction.response);
    const status = Number(response.status || 200);
    return {
      id: String(interaction.description || `interaction-${index + 1}`),
      method: String(request.method || 'GET').toUpperCase(), path: String(request.path || '/'),
      requestSchema: inferSchema(request.body), responseSchemas: { [status]: inferSchema(response.body) }, provider, consumer
    };
  });

  return { id: `pact:${slug(consumer)}:${slug(provider)}:${version}`, source: 'pact', name: `${consumer} -> ${provider}`, version, operations };
}

/** Links and validates one E2E API exchange against its published contract. */
export function validateApiExchange(registry: ContractRegistry, exchange: ApiExchange): ContractValidationResult {
  const match = registry.findOperation(exchange.method, exchange.path);
  if (!match) return { compliant: false, errors: [`No contract operation matches ${exchange.method.toUpperCase()} ${exchange.path}`] };

  const errors: string[] = [];
  if (match.operation.requestSchema) errors.push(...validateJsonSchema(exchange.requestBody, match.operation.requestSchema, 'request.body'));
  if (!Object.prototype.hasOwnProperty.call(match.operation.responseSchemas, exchange.status)) {
    errors.push(`response.status (undocumented status ${exchange.status})`);
  } else {
    const schema = match.operation.responseSchemas[exchange.status];
    if (schema) errors.push(...validateJsonSchema(exchange.responseBody, schema, 'response.body'));
  }
  return { compliant: errors.length === 0, contractId: match.contract.id, operationId: match.operation.id, errors };
}

/** Validates production endpoints and notifies the team for each detected drift. */
export async function detectProductionDrift(options: {
  registry: ContractRegistry; baseUrl: string; fetcher: ContractFetch; notify?: DriftNotifier;
}): Promise<ContractDriftAlert[]> {
  const alerts: ContractDriftAlert[] = [];
  for (const contract of options.registry.list()) {
    for (const operation of contract.operations) {
      // Production drift probes must be read-only and must not guess path
      // parameters. Stateful operations are validated from captured E2E
      // exchanges instead of being replayed against production.
      if (operation.path.includes('{') || !['GET', 'HEAD'].includes(operation.method.toUpperCase())) continue;
      const endpoint = `${options.baseUrl.replace(/\/$/, '')}${operation.path}`;
      try {
        const response = await options.fetcher(endpoint, { method: operation.method });
        const body = await response.json();
        const result = validateApiExchange(options.registry, { method: operation.method, path: operation.path, status: response.status, responseBody: body });
        if (!result.compliant) alerts.push(await emitAlert(contract.id, operation.id, endpoint, result.errors, options.notify));
      } catch (error) {
        alerts.push(await emitAlert(contract.id, operation.id, endpoint, [`Production probe failed: ${errorMessage(error)}`], options.notify));
      }
    }
  }
  return alerts;
}

/** Generates aggregate compliance metrics for a set of E2E exchanges. */
export function generateComplianceReport(registry: ContractRegistry, exchanges: ApiExchange[]): ComplianceReport {
  const results = exchanges.map(exchange => validateApiExchange(registry, exchange));
  const compliant = results.filter(result => result.compliant).length;
  const percentage = results.length ? Math.round((compliant / results.length) * 10000) / 100 : 100;
  return { total: results.length, compliant, nonCompliant: results.length - compliant, compliancePercentage: percentage,
    summary: `${percentage}% of requests comply with published contract`, results };
}

function validateJsonSchema(value: unknown, schema: JsonSchema, path: string): string[] {
  if (value === null && schema.nullable) return [];
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const expected = schema.type === 'integer' ? 'number' : schema.type;
  const errors: string[] = [];
  if (expected && actual !== expected) return [`${path} (expected ${schema.type}, got ${actual})`];
  if (schema.type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) errors.push(`${path} (expected integer)`);
  if (schema.enum && !schema.enum.some(candidate => candidate === value)) errors.push(`${path} (value is not in enum)`);
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required || []) if (!(required in record)) errors.push(`${path}.${required} (missing required field)`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in record) errors.push(...validateJsonSchema(record[key], child, `${path}.${key}`));
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items!, `${path}[${index}]`)));
  return errors;
}

function matchPath(template: string, actual: string): boolean {
  const clean = actual.split('?')[0];
  const pattern = template.split('/').map(part => part.startsWith('{') && part.endsWith('}') ? '[^/]+' : escapeRegex(part)).join('/');
  return new RegExp(`^${pattern}/?$`).test(clean);
}

function inferSchema(value: unknown): JsonSchema | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferSchema(value[0]) : {} };
  if (typeof value === 'object') {
    const properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, inferSchema(child) || {}]));
    return { type: 'object', properties, required: Object.keys(properties) };
  }
  return { type: typeof value as 'string' | 'number' | 'boolean' };
}

async function emitAlert(contractId: string, operationId: string, endpoint: string, errors: string[], notify?: DriftNotifier): Promise<ContractDriftAlert> {
  const alert = { contractId, operationId, endpoint, errors, detectedAt: new Date().toISOString() };
  log.warn('Contract drift detected', { contractId, operationId, endpoint, errors });
  if (notify) await notify(alert);
  return alert;
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
