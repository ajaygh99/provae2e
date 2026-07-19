import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateTestData, generateTestDataFromFile } from '../../src/core/test-data-factory';

describe('generateTestData', () => {
  it('generates primitive types and enums', () => {
    expect(generateTestData({ type: 'string' })).toMatchObject({ ok: true, data: 'sample-text' });
    expect(generateTestData({ type: 'integer', minimum: 3, maximum: 8 })).toEqual({ ok: true, data: 3 });
    expect(generateTestData({ type: 'number', minimum: 1.5, maximum: 2 })).toEqual({ ok: true, data: 1.5 });
    expect(generateTestData({ type: 'boolean' })).toEqual({ ok: true, data: true });
    expect(generateTestData({ type: 'null' })).toEqual({ ok: true, data: null });
    expect(generateTestData({ type: 'string', enum: ['active', 'disabled'] })).toEqual({ ok: true, data: 'active' });
  });

  it.each([
    ['email', /^[^@]+@example\.com$/],
    ['date', /^\d{4}-\d{2}-\d{2}$/],
    ['date-time', /^\d{4}-\d{2}-\d{2}T/],
    ['uuid', /^[0-9a-f]{8}-[0-9a-f-]{27}$/],
    ['uri', /^https:\/\/example\.com\//],
    ['hostname', /^test\.example\.com$/],
    ['ipv4', /^192\.0\.2\.1$/]
  ])('generates the %s string format', (format, expected) => {
    const result = generateTestData({ type: 'string', format });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual(expect.stringMatching(expected as RegExp));
  });

  it('generates nested objects, constrained arrays, and required fields', () => {
    const schema = {
      type: 'object',
      required: ['id', 'profile'],
      properties: {
        id: { type: 'integer', minimum: 10, maximum: 20 },
        profile: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' }, nickname: { type: 'string' } }
        },
        roles: { type: 'array', minItems: 3, maxItems: 3, items: { enum: ['tester', 'admin'] } }
      }
    };
    const result = generateTestData(schema, { includeOptional: false });
    expect(result.ok && result.data).toEqual({
      id: 10,
      profile: { email: expect.stringMatching(/@example\.com$/) }
    });

    const withOptional = generateTestData(schema);
    expect(withOptional.ok && withOptional.data).toMatchObject({ roles: ['tester', 'tester', 'tester'] });
  });

  it('honors string lengths, exclusive numeric bounds, and record count', () => {
    expect(generateTestData({ type: 'string', minLength: 15, maxLength: 15 })).toEqual({
      ok: true,
      data: 'sample-textxxxx'
    });
    expect(generateTestData({ type: 'integer', exclusiveMinimum: 4, exclusiveMaximum: 7 })).toEqual({ ok: true, data: 5 });
    const result = generateTestData({ type: 'integer' }, { count: 3 });
    expect(result).toEqual({ ok: true, data: [1, 1, 1] });
  });

  it('supports descriptor shapes and infers a basic schema from examples', () => {
    const shape = generateTestData({ email: 'email', age: 'integer', tags: ['string'] });
    expect(shape.ok && shape.data).toMatchObject({
      email: expect.stringMatching(/@example\.com$/), age: 1, tags: ['sample-text', 'sample-text']
    });
    const example = generateTestData({ name: 'Alice', active: false, score: 1.5 });
    expect(example).toEqual({ ok: true, data: { name: 'sample-text', active: true, score: 1 } });
  });

  it('returns clear errors for invalid counts and unsupported or malformed schemas', () => {
    expect(generateTestData({ type: 'string' }, { count: 0 })).toEqual({ ok: false, error: 'Count must be a positive integer' });
    expect(generateTestData({ type: 'string' }, { count: 1.5 })).toEqual({ ok: false, error: 'Count must be a positive integer' });
    expect(generateTestData({ $ref: '#/$defs/user' })).toEqual({ ok: false, error: 'Unsupported schema feature "$ref" at $' });
    expect(generateTestData({ type: ['string', 'null'] })).toEqual({ ok: false, error: 'Unsupported schema feature "union type" at $' });
    expect(generateTestData({ type: 'array', items: true })).toEqual({ ok: false, error: 'Array schema requires a single object "items" schema at $' });
    expect(generateTestData({ type: 'string', format: 'regex' })).toEqual({ ok: false, error: 'Unsupported string format "regex"' });
    expect(generateTestData({ type: 'number', minimum: 5, maximum: 2 })).toEqual({ ok: false, error: 'maximum must be greater than or equal to minimum' });
    expect(generateTestData({ type: 'integer', minimum: 1.2, maximum: 1.8 })).toEqual({ ok: false, error: 'Numeric constraints do not contain a valid integer' });
    expect(generateTestData({ type: 'string', format: 'date', maxLength: 5 })).toEqual({
      ok: false,
      error: 'String format "date" cannot satisfy the requested length constraints'
    });
    expect(generateTestData({ type: 'string', pattern: '^[A-Z]+$' })).toEqual({ ok: false, error: 'Unsupported schema feature "pattern" at $' });
    expect(generateTestData({ type: 'object', properties: [] })).toEqual({ ok: false, error: 'Object "properties" must be an object at $' });
    expect(generateTestData({ type: 'object', properties: {}, required: 'id' })).toEqual({ ok: false, error: 'Object "required" must be an array of property names at $' });
    expect(generateTestData({ type: 'object', properties: { id: true } })).toEqual({ ok: false, error: 'Property schema must be an object at $.id' });
    expect(generateTestData({ type: 'object', properties: {}, required: ['id'] })).toEqual({ ok: false, error: 'Required property "id" has no schema at $' });
    expect(generateTestData({ type: 'funky' })).toEqual({ ok: false, error: 'Unsupported or missing schema type at $' });
    expect(generateTestData({ enum: [] })).toEqual({ ok: false, error: 'enum must contain at least one value at $' });
  });

  it('supports constants and truncates unconstrained-format strings to maxLength', () => {
    expect(generateTestData({ const: 42 })).toEqual({ ok: true, data: 42 });
    expect(generateTestData({ type: 'string', maxLength: 6 })).toEqual({ ok: true, data: 'sample' });
    expect(generateTestData({ type: 'array', minItems: 3, maxItems: 1, items: { type: 'string' } })).toEqual({
      ok: false,
      error: 'maxItems must be greater than or equal to minItems'
    });
  });
});

describe('generateTestDataFromFile', () => {
  it('loads valid JSON and reports malformed or unreadable files without throwing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'prova-data-'));
    const valid = path.join(directory, 'schema.json');
    const malformed = path.join(directory, 'broken.json');
    writeFileSync(valid, JSON.stringify({ type: 'string' }));
    writeFileSync(malformed, '{ nope');
    await expect(generateTestDataFromFile(valid)).resolves.toEqual({ ok: true, data: 'sample-text' });
    await expect(generateTestDataFromFile(malformed)).resolves.toEqual({ ok: false, error: `Schema file is not valid JSON: ${malformed}` });
    const missing = await generateTestDataFromFile(path.join(directory, 'missing.json'));
    expect(!missing.ok && missing.error).toContain('Unable to read schema file');
  });
});
