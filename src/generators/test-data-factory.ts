/** Faker-backed JSON Schema test-data generation and serialization. */
import { faker } from '@faker-js/faker';
import { readFile } from 'node:fs/promises';

type Schema = Record<string, unknown>;
export type DataFormat = 'json' | 'csv' | 'env' | 'sql';

/** Options for advanced schema-aware generation. */
export interface AdvancedDataOptions {
  count?: number;
  seed?: number;
  edgeCases?: boolean;
  includeOptional?: boolean;
}

/** Result of advanced test-data generation. */
export type AdvancedDataResult =
  | { ok: true; records: unknown[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveReference(root: Schema, reference: string): Schema {
  if (!reference.startsWith('#/')) throw new Error(`Only local JSON Schema references are supported: ${reference}`);
  let current: unknown = root;
  for (const segment of reference.slice(2).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(current) || !(key in current)) throw new Error(`Unresolved JSON Schema reference: ${reference}`);
    current = current[key];
  }
  if (!isRecord(current)) throw new Error(`JSON Schema reference is not an object: ${reference}`);
  return current;
}

function patternValue(pattern: string): string {
  if (pattern === '^\\d{3}-\\d{4}$' || pattern === '\\d{3}-\\d{4}') {
    return `${faker.string.numeric(3)}-${faker.string.numeric(4)}`;
  }
  if (/^\^\[A-Z\]\+\$$/.test(pattern)) return faker.string.alpha({ length: 8, casing: 'upper' });
  throw new Error(`Unsupported string pattern "${pattern}"`);
}

function stringValue(schema: Schema, edgeCases: boolean): string {
  const format = schema['format'];
  let value: string;
  if (typeof schema['pattern'] === 'string') value = patternValue(schema['pattern']);
  else if (format === 'email') value = faker.internet.email();
  else if (format === 'date') value = faker.date.past().toISOString().slice(0, 10);
  else if (format === 'date-time') value = faker.date.past().toISOString();
  else if (format === 'uuid') value = faker.string.uuid();
  else if (format === 'uri' || format === 'url') value = faker.internet.url();
  else if (format === 'hostname') value = faker.internet.domainName();
  else if (format === 'ipv4') value = faker.internet.ipv4();
  else if (format === undefined) value = faker.lorem.word();
  else throw new Error(`Unsupported string format "${String(format)}"`);
  const minimum = typeof schema['minLength'] === 'number' ? Math.max(0, Math.ceil(schema['minLength'])) : 0;
  const maximum = typeof schema['maxLength'] === 'number' ? Math.floor(schema['maxLength']) : Number.MAX_SAFE_INTEGER;
  if (maximum < minimum) throw new Error('maxLength must be greater than or equal to minLength');
  if (edgeCases && minimum === 0) return '';
  if (value.length < minimum) value = value.padEnd(minimum, 'x');
  return value.slice(0, maximum);
}

function numericValue(schema: Schema, integer: boolean, edgeCases: boolean): number {
  const minimum = typeof schema['minimum'] === 'number' ? schema['minimum'] : 0;
  const maximum = typeof schema['maximum'] === 'number' ? schema['maximum'] : Math.max(minimum, 100);
  if (maximum < minimum) throw new Error('maximum must be greater than or equal to minimum');
  if (edgeCases) return integer ? Math.ceil(maximum) : maximum;
  return integer
    ? faker.number.int({ min: Math.ceil(minimum), max: Math.floor(maximum) })
    : faker.number.float({ min: minimum, max: maximum, fractionDigits: 2 });
}

function generate(schema: Schema, root: Schema, options: Required<Omit<AdvancedDataOptions, 'seed'>>, path: string): unknown {
  if (typeof schema['$ref'] === 'string') return generate(resolveReference(root, schema['$ref']), root, options, path);
  if (Array.isArray(schema['enum'])) {
    if (schema['enum'].length === 0) throw new Error(`enum must not be empty at ${path}`);
    return faker.helpers.arrayElement(schema['enum']);
  }
  if ('const' in schema) return schema['const'];
  const declared = schema['type'];
  if (Array.isArray(declared)) {
    const nullable = declared.includes('null');
    if (nullable && options.edgeCases) return null;
    const actual = declared.find((type) => type !== 'null');
    if (typeof actual !== 'string') return null;
    return generate({ ...schema, type: actual }, root, options, path);
  }
  const type = declared ?? (isRecord(schema['properties']) ? 'object' : undefined);
  switch (type) {
    case 'string': return stringValue(schema, options.edgeCases);
    case 'integer': return numericValue(schema, true, options.edgeCases);
    case 'number': return numericValue(schema, false, options.edgeCases);
    case 'boolean': return faker.datatype.boolean();
    case 'null': return null;
    case 'array': {
      if (!isRecord(schema['items'])) throw new Error(`Array items must be a schema at ${path}`);
      const minimum = typeof schema['minItems'] === 'number' ? Math.max(0, Math.ceil(schema['minItems'])) : 1;
      const maximum = typeof schema['maxItems'] === 'number' ? Math.floor(schema['maxItems']) : Math.max(minimum, 2);
      if (maximum < minimum) throw new Error(`maxItems must be at least minItems at ${path}`);
      const count = options.edgeCases ? maximum : faker.number.int({ min: minimum, max: maximum });
      return Array.from({ length: count }, (_, index) => generate(schema['items'] as Schema, root, options, `${path}[${index}]`));
    }
    case 'object': {
      if (!isRecord(schema['properties'])) throw new Error(`Object properties must be a schema map at ${path}`);
      const required = new Set(Array.isArray(schema['required']) ? schema['required'] : []);
      const output: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(schema['properties'])) {
        if (!isRecord(child)) throw new Error(`Property schema must be an object at ${path}.${name}`);
        if (required.has(name) || options.includeOptional) output[name] = generate(child, root, options, `${path}.${name}`);
      }
      return output;
    }
    default: throw new Error(`Unsupported or missing schema type at ${path}`);
  }
}

/** Generates Faker-backed records from a JSON Schema. */
export function generateAdvancedTestData(schema: unknown, options: AdvancedDataOptions = {}): AdvancedDataResult {
  try {
    if (!isRecord(schema)) return { ok: false, error: 'Schema must be a JSON object' };
    const count = options.count ?? 1;
    if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Count must be a positive integer' };
    if (options.seed !== undefined && !Number.isInteger(options.seed)) return { ok: false, error: 'Seed must be an integer' };
    faker.seed(options.seed ?? Date.now());
    const normalized = { count, edgeCases: options.edgeCases ?? false, includeOptional: options.includeOptional ?? true };
    return { ok: true, records: Array.from({ length: count }, () => generate(schema, schema, normalized, '$')) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Loads a JSON Schema file and generates Faker-backed records. */
export async function generateAdvancedTestDataFromFile(filePath: string, options: AdvancedDataOptions = {}): Promise<AdvancedDataResult> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as unknown;
    return generateAdvancedTestData(parsed, options);
  } catch (error) {
    return { ok: false, error: `Unable to load schema "${filePath}": ${error instanceof Error ? error.message : String(error)}` };
  }
}

function flatten(value: unknown, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, output);
  } else output[prefix] = Array.isArray(value) ? JSON.stringify(value) : value;
  return output;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serializes generated records to JSON, CSV, ENV, or SQL. */
export function serializeTestData(records: unknown[], format: DataFormat, table = 'test_data'): string {
  if (format === 'json') return `${JSON.stringify(records.length === 1 ? records[0] : records, null, 2)}\n`;
  const rows = records.map((record) => flatten(record));
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (format === 'csv') return `${headers.join(',')}\n${rows.map((row) => headers.map((key) => csvCell(row[key])).join(',')).join('\n')}\n`;
  if (format === 'env') {
    if (rows.length !== 1) throw new Error('ENV output supports exactly one record');
    return `${headers.map((key) => `${key.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}=${String(rows[0][key] ?? '')}`).join('\n')}\n`;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('SQL table name is invalid');
  return `${rows.map((row) => {
    const values = headers.map((key) => row[key] === null || row[key] === undefined ? 'NULL' : `'${String(row[key]).replace(/'/g, "''")}'`);
    const columns = headers.map((key) => `"${key.replace(/"/g, '""')}"`).join(', ');
    return `INSERT INTO ${table} (${columns}) VALUES (${values.join(', ')});`;
  }).join('\n')}\n`;
}
