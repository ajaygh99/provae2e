import { generateAdvancedTestData, serializeTestData } from '../../src/generators/test-data-factory';

describe('generateAdvancedTestData', () => {
  const schema = {
    type: 'object', required: ['email', 'age', 'profile'],
    properties: {
      email: { type: 'string', format: 'email' },
      age: { type: 'integer', minimum: 18, maximum: 65 },
      active: { type: 'boolean' },
      profile: { $ref: '#/$defs/profile' },
      phone: { type: 'string', pattern: '^\\d{3}-\\d{4}$' },
      tags: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } }
    },
    $defs: { profile: { type: 'object', properties: { name: { type: 'string', minLength: 3 } } } }
  };

  it('uses Faker for constrained nested records, arrays, patterns, and refs', () => {
    const result = generateAdvancedTestData(schema, { count: 2, seed: 42 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.records).toHaveLength(2);
    expect(result.ok && result.records[0]).toEqual(expect.objectContaining({
      email: expect.stringContaining('@'), age: expect.any(Number),
      phone: expect.stringMatching(/^\d{3}-\d{4}$/), tags: expect.any(Array),
      profile: { name: expect.any(String) }
    }));
  });

  it('produces reproducible output for the same seed', () => {
    const first = generateAdvancedTestData(schema, { seed: 99 });
    const second = generateAdvancedTestData(schema, { seed: 99 });
    expect(second).toEqual(first);
  });

  it('generates edge values including nullable, empty, and maximum values', () => {
    const result = generateAdvancedTestData({
      type: 'object', properties: {
        nullable: { type: ['string', 'null'] }, empty: { type: 'string' },
        maximum: { type: 'number', minimum: 1, maximum: 9 }
      }
    }, { seed: 1, edgeCases: true });
    expect(result).toEqual({ ok: true, records: [{ nullable: null, empty: '', maximum: 9 }] });
  });

  it('can omit optional fields', () => {
    const result = generateAdvancedTestData(schema, { seed: 1, includeOptional: false });
    expect(result.ok && result.records[0]).not.toHaveProperty('phone');
    expect(result.ok && result.records[0]).toHaveProperty('profile');
  });

  it.each([
    [null, {}, 'Schema must be a JSON object'],
    [{ type: 'string' }, { count: 0 }, 'Count must be a positive integer'],
    [{ type: 'string' }, { seed: 1.5 }, 'Seed must be an integer'],
    [{ $ref: '#/$defs/missing', $defs: {} }, {}, 'Unresolved JSON Schema reference'],
    [{ $ref: 'https://example.com/schema' }, {}, 'Only local JSON Schema references'],
    [{ type: 'string', pattern: '^unsupported$' }, {}, 'Unsupported string pattern'],
    [{ type: 'string', format: 'unknown' }, {}, 'Unsupported string format'],
    [{ type: 'integer', minimum: 10, maximum: 1 }, {}, 'maximum must be greater'],
    [{ type: 'array', items: true }, {}, 'Array items must be a schema'],
    [{ type: 'object', properties: [] }, {}, 'Object properties must be a schema map']
  ])('returns safe validation error %#', (input, options, message) => {
    const result = generateAdvancedTestData(input, options);
    expect(!result.ok && result.error).toContain(message);
  });
});

describe('serializeTestData', () => {
  const records = [{ name: 'Ajay', profile: { role: 'QE' }, tags: ['a', 'b'], quote: "O'Reilly" }];

  it('serializes JSON', () => expect(serializeTestData(records, 'json')).toContain('"name": "Ajay"'));
  it('serializes flattened CSV', () => expect(serializeTestData(records, 'csv')).toContain('profile.role'));
  it('serializes flattened ENV', () => expect(serializeTestData(records, 'env')).toContain('PROFILE_ROLE=QE'));
  it('serializes escaped SQL', () => expect(serializeTestData(records, 'sql', 'users')).toContain("O''Reilly"));
  it('rejects multiple ENV records', () => expect(() => serializeTestData([{}, {}], 'env')).toThrow('exactly one'));
  it('rejects unsafe SQL table names', () => expect(() => serializeTestData(records, 'sql', 'users;drop')).toThrow('invalid'));
});
