/** Dependency-free, schema-aware test data generation. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Options controlling generated records. */
export interface TestDataFactoryOptions {
  /** Number of records to generate. Defaults to 1. */
  count?: number;
  /** Include non-required object properties. Defaults to true. */
  includeOptional?: boolean;
}

/** Successful or failed test-data generation. */
export type TestDataFactoryResult =
  | { ok: true; data: unknown | unknown[] }
  | { ok: false; error: string };

type JsonSchema = Record<string, unknown>;

const DESCRIPTORS: Record<string, JsonSchema> = {
  string: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  email: { type: 'string', format: 'email' },
  date: { type: 'string', format: 'date' },
  'date-time': { type: 'string', format: 'date-time' },
  uuid: { type: 'string', format: 'uuid' },
  url: { type: 'string', format: 'uri' },
  uri: { type: 'string', format: 'uri' },
  hostname: { type: 'string', format: 'hostname' },
  ipv4: { type: 'string', format: 'ipv4' }
};

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchema(value: JsonSchema): boolean {
  return [
    '$schema', '$ref', 'type', 'properties', 'items', 'enum', 'const', 'format', 'required',
    'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'pattern', 'patternProperties', 'prefixItems', 'contains'
  ].some((key) => key in value);
}

function inferSchema(value: unknown): JsonSchema {
  if (typeof value === 'string' && DESCRIPTORS[value.toLowerCase()]) {
    return DESCRIPTORS[value.toLowerCase()];
  }
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferSchema(value[0]) : { type: 'string' } };
  }
  if (isRecord(value)) {
    const properties = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inferSchema(child)]));
    return { type: 'object', properties, required: Object.keys(properties) };
  }
  if (value === null) return { type: 'null' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return { type: typeof value };
}

function normalizedSchema(input: unknown): JsonSchema {
  return isRecord(input) && isSchema(input) ? input : inferSchema(input);
}

function unsupportedKeyword(schema: JsonSchema): string | undefined {
  return ['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'pattern', 'patternProperties', 'prefixItems', 'contains']
    .find((keyword) => keyword in schema);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundedLength(schema: JsonSchema, minimumKey: string, maximumKey: string, fallback: number): number {
  const minimum = Math.max(0, Math.ceil(finiteNumber(schema[minimumKey], 0)));
  const maximum = Math.floor(finiteNumber(schema[maximumKey], Math.max(minimum, fallback)));
  if (maximum < minimum) throw new Error(`${maximumKey} must be greater than or equal to ${minimumKey}`);
  return Math.min(Math.max(minimum, fallback), maximum);
}

function stringValue(schema: JsonSchema): string {
  const format = schema['format'];
  let value: string;
  switch (format) {
    case 'email': value = `user-${randomUUID().slice(0, 8)}@example.com`; break;
    case 'date': value = new Date().toISOString().slice(0, 10); break;
    case 'date-time': value = new Date().toISOString(); break;
    case 'uuid': value = randomUUID(); break;
    case 'uri':
    case 'url': value = `https://example.com/test-${randomUUID().slice(0, 8)}`; break;
    case 'hostname': value = 'test.example.com'; break;
    case 'ipv4': value = '192.0.2.1'; break;
    case undefined: value = 'sample-text'; break;
    default: throw new Error(`Unsupported string format "${String(format)}"`);
  }
  const minimum = Math.max(0, Math.ceil(finiteNumber(schema['minLength'], 0)));
  const maximum = Math.floor(finiteNumber(schema['maxLength'], Number.MAX_SAFE_INTEGER));
  if (maximum < minimum) throw new Error('maxLength must be greater than or equal to minLength');
  if (format !== undefined && (value.length < minimum || value.length > maximum)) {
    throw new Error(`String format "${String(format)}" cannot satisfy the requested length constraints`);
  }
  const length = boundedLength(schema, 'minLength', 'maxLength', value.length);
  if (value.length > length) return value.slice(0, length);
  return value.padEnd(length, 'x');
}

function numberValue(schema: JsonSchema, integer: boolean): number {
  let minimum = finiteNumber(schema['minimum'], 1);
  let maximum = finiteNumber(schema['maximum'], Math.max(minimum, 100));
  if (typeof schema['exclusiveMinimum'] === 'number') minimum = schema['exclusiveMinimum'] + (integer ? 1 : 0.1);
  if (typeof schema['exclusiveMaximum'] === 'number') maximum = schema['exclusiveMaximum'] - (integer ? 1 : 0.1);
  if (integer) {
    const lower = Math.ceil(minimum);
    const upper = Math.floor(maximum);
    if (upper < lower) throw new Error('Numeric constraints do not contain a valid integer');
    return lower;
  }
  if (maximum < minimum) throw new Error('maximum must be greater than or equal to minimum');
  return minimum;
}

function generateValue(schema: JsonSchema, includeOptional: boolean, path: string): unknown {
  const unsupported = unsupportedKeyword(schema);
  if (unsupported) throw new Error(`Unsupported schema feature "${unsupported}" at ${path}`);
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) {
    if (enumValues.length === 0) throw new Error(`enum must contain at least one value at ${path}`);
    return enumValues[0];
  }
  if ('const' in schema) return schema['const'];

  const inferredType = schema['type'] ?? (isRecord(schema['properties']) ? 'object' : schema['items'] ? 'array' : undefined);
  if (Array.isArray(inferredType)) throw new Error(`Unsupported schema feature "union type" at ${path}`);
  switch (inferredType) {
    case 'string': return stringValue(schema);
    case 'number': return numberValue(schema, false);
    case 'integer': return numberValue(schema, true);
    case 'boolean': return true;
    case 'null': return null;
    case 'array': {
      if (!isRecord(schema['items'])) throw new Error(`Array schema requires a single object "items" schema at ${path}`);
      const length = boundedLength(schema, 'minItems', 'maxItems', 2);
      return Array.from({ length }, (_, index) => generateValue(schema['items'] as JsonSchema, includeOptional, `${path}[${index}]`));
    }
    case 'object': {
      const properties = schema['properties'];
      if (properties !== undefined && !isRecord(properties)) throw new Error(`Object "properties" must be an object at ${path}`);
      const requiredValue = schema['required'];
      if (requiredValue !== undefined && (!Array.isArray(requiredValue) || requiredValue.some((item) => typeof item !== 'string'))) {
        throw new Error(`Object "required" must be an array of property names at ${path}`);
      }
      const required = new Set((requiredValue as string[] | undefined) ?? []);
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(properties ?? {})) {
        if (!isRecord(child)) throw new Error(`Property schema must be an object at ${path}.${key}`);
        if (includeOptional || required.has(key)) result[key] = generateValue(child, includeOptional, `${path}.${key}`);
      }
      for (const key of required) {
        if (!(key in (properties ?? {}))) throw new Error(`Required property "${key}" has no schema at ${path}`);
      }
      return result;
    }
    default: throw new Error(`Unsupported or missing schema type at ${path}`);
  }
}

/**
 * Generates JSON-compatible test data from JSON Schema, a descriptor shape,
 * or an example JSON value. Operational and validation failures are returned.
 *
 * @param input - Schema, descriptor shape, or example JSON value.
 * @param options - Record count and optional-field behavior.
 * @returns Generated data or a clear validation error.
 */
export function generateTestData(input: unknown, options: TestDataFactoryOptions = {}): TestDataFactoryResult {
  try {
    const count = options.count ?? 1;
    if (!Number.isInteger(count) || count <= 0) return { ok: false, error: 'Count must be a positive integer' };
    const schema = normalizedSchema(input);
    const records = Array.from({ length: count }, () => generateValue(schema, options.includeOptional ?? true, '$'));
    return { ok: true, data: count === 1 ? records[0] : records };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reads a JSON file and generates test data without exposing raw exceptions.
 *
 * @param filePath - JSON Schema, descriptor-shape, or example JSON file.
 * @param options - Record count and optional-field behavior.
 * @returns Generated data or a concise file/schema error.
 */
export async function generateTestDataFromFile(
  filePath: string,
  options: TestDataFactoryOptions = {}
): Promise<TestDataFactoryResult> {
  try {
    const source = await readFile(filePath, 'utf-8');
    let input: unknown;
    try {
      input = JSON.parse(source) as unknown;
    } catch {
      return { ok: false, error: `Schema file is not valid JSON: ${filePath}` };
    }
    return generateTestData(input, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Unable to read schema file "${filePath}": ${message}` };
  }
}
