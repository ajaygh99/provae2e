/**
 * Schema Validator Tests
 */
import { validateNestedSchema, type NestedSchema } from '../../src/core/schema-validator';

describe('validateNestedSchema', () => {
  describe('Primitive types', () => {
    it('validates string type correctly', () => {
      const schema: NestedSchema = { type: 'string' };
      expect(validateNestedSchema('hello', schema)).toEqual([]);
      const errors1 = validateNestedSchema(123, schema);
      expect(errors1[0]).toContain('expected string');
      const errors2 = validateNestedSchema(null, schema);
      expect(errors2[0]).toContain('expected string');
    });

    it('validates number type correctly', () => {
      const schema: NestedSchema = { type: 'number' };
      expect(validateNestedSchema(42, schema)).toEqual([]);
      expect(validateNestedSchema(3.14, schema)).toEqual([]);
      const errors = validateNestedSchema('42', schema);
      expect(errors[0]).toContain('expected number');
    });

    it('validates boolean type correctly', () => {
      const schema: NestedSchema = { type: 'boolean' };
      expect(validateNestedSchema(true, schema)).toEqual([]);
      expect(validateNestedSchema(false, schema)).toEqual([]);
      const errors = validateNestedSchema(1, schema);
      expect(errors[0]).toContain('expected boolean');
    });

    it('validates null type correctly', () => {
      const schema: NestedSchema = { type: 'null' };
      expect(validateNestedSchema(null, schema)).toEqual([]);
      const errors1 = validateNestedSchema(undefined, schema);
      expect(errors1[0]).toContain('missing required field');
      const errors2 = validateNestedSchema('null', schema);
      expect(errors2[0]).toContain('expected null');
    });
  });

  describe('Nullable fields', () => {
    it('accepts null when nullable is true', () => {
      const schema: NestedSchema = { type: 'string', nullable: true };
      expect(validateNestedSchema(null, schema)).toEqual([]);
      expect(validateNestedSchema('hello', schema)).toEqual([]);
    });

    it('rejects null when nullable is false or not set', () => {
      const schema: NestedSchema = { type: 'string', nullable: false };
      const errors = validateNestedSchema(null, schema);
      expect(errors[0]).toContain('expected string');
    });

    it('supports nullable on all primitive types', () => {
      const schemas: NestedSchema[] = [
        { type: 'number', nullable: true },
        { type: 'boolean', nullable: true },
        { type: 'object', properties: {}, nullable: true },
        { type: 'array', items: { type: 'string' }, nullable: true }
      ];
      for (const schema of schemas) {
        expect(validateNestedSchema(null, schema)).toEqual([]);
      }
    });
  });

  describe('Optional fields', () => {
    it('accepts undefined when optional is true', () => {
      const schema: NestedSchema = { type: 'string', optional: true };
      expect(validateNestedSchema(undefined, schema)).toEqual([]);
      expect(validateNestedSchema('hello', schema)).toEqual([]);
    });

    it('rejects undefined when optional is false or not set', () => {
      const schema: NestedSchema = { type: 'string', optional: false };
      const errors = validateNestedSchema(undefined, schema);
      expect(errors[0]).toContain('missing required field');
    });
  });

  describe('Objects', () => {
    it('validates simple flat objects', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          active: { type: 'boolean' }
        }
      };
      const obj = { id: 1, name: 'Alice', active: true };
      expect(validateNestedSchema(obj, schema)).toEqual([]);
    });

    it('rejects missing required properties', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' }
        }
      };
      const obj = { id: 1 };
      const errors = validateNestedSchema(obj, schema);
      expect(errors[0]).toContain('missing required field');
      expect(errors[0]).toContain('name');
    });

    it('reports incorrect field types', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' }
        }
      };
      const obj = { id: '1', name: 'Alice' };
      const errors = validateNestedSchema(obj, schema);
      expect(errors[0]).toContain('expected number');
      expect(errors[0]).toContain('id');
    });

    it('validates nested objects', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              profile: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' }
                }
              }
            }
          }
        }
      };
      const obj = { user: { id: 1, profile: { name: 'Alice', age: 30 } } };
      expect(validateNestedSchema(obj, schema)).toEqual([]);
    });

    it('includes full path in nested object errors', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  age: { type: 'number' }
                }
              }
            }
          }
        }
      };
      const obj = { user: { profile: { age: 'thirty' } } };
      const errors = validateNestedSchema(obj, schema);
      expect(errors[0]).toContain('user.profile.age');
    });

    it('supports optional properties in objects', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          email: { type: 'string', optional: true }
        }
      };
      expect(validateNestedSchema({ id: 1 }, schema)).toEqual([]);
      expect(validateNestedSchema({ id: 1, email: undefined }, schema)).toEqual([]);
      expect(validateNestedSchema({ id: 1, email: 'test@example.com' }, schema)).toEqual([]);
    });

    it('supports nullable properties in objects', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          email: { type: 'string', nullable: true }
        }
      };
      expect(validateNestedSchema({ id: 1, email: null }, schema)).toEqual([]);
      expect(validateNestedSchema({ id: 1, email: 'test@example.com' }, schema)).toEqual([]);
    });

    it('rejects non-object values', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: { id: { type: 'number' } }
      };
      const errors1 = validateNestedSchema([1, 2], schema);
      expect(errors1[0]).toContain('expected object');
      const errors2 = validateNestedSchema('not-an-object', schema);
      expect(errors2[0]).toContain('expected object');
      const errors3 = validateNestedSchema(null, schema);
      expect(errors3[0]).toContain('expected object');
    });
  });

  describe('Arrays', () => {
    it('validates arrays of primitives', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'string' } };
      expect(validateNestedSchema(['a', 'b', 'c'], schema)).toEqual([]);
    });

    it('validates homogeneous array elements', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'number' } };
      const errors = validateNestedSchema([1, 2, 'three'], schema);
      expect(errors.some(e => e.includes('[2]'))).toBe(true);
      expect(errors[0]).toContain('expected number');
    });

    it('includes array index in error messages', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'number' } };
      const errors = validateNestedSchema([10, 20, 'thirty'], schema);
      expect(errors[0]).toContain('[2]');
    });

    it('validates arrays of objects', () => {
      const schema: NestedSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' }
          }
        }
      };
      const arr = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ];
      expect(validateNestedSchema(arr, schema)).toEqual([]);
    });

    it('reports errors in nested array objects with correct path', () => {
      const schema: NestedSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' }
          }
        }
      };
      const arr = [
        { id: 1, name: 'Alice' },
        { id: 'two', name: 'Bob' }
      ];
      const errors = validateNestedSchema(arr, schema);
      expect(errors[0]).toContain('[1].id');
    });

    it('supports nullable arrays', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'string' }, nullable: true };
      expect(validateNestedSchema(null, schema)).toEqual([]);
      expect(validateNestedSchema(['a', 'b'], schema)).toEqual([]);
    });

    it('supports optional arrays', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'string' }, optional: true };
      expect(validateNestedSchema(undefined, schema)).toEqual([]);
      expect(validateNestedSchema(['a', 'b'], schema)).toEqual([]);
    });

    it('rejects non-array values', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'string' } };
      const errors1 = validateNestedSchema({ 0: 'a' }, schema);
      expect(errors1[0]).toContain('expected array');
      const errors2 = validateNestedSchema('not-an-array', schema);
      expect(errors2[0]).toContain('expected array');
      const errors3 = validateNestedSchema(null, schema);
      expect(errors3[0]).toContain('expected array');
    });

    it('validates deeply nested arrays of objects', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                tags: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        }
      };
      const obj = {
        data: [
          { id: 1, tags: ['tag1', 'tag2'] },
          { id: 2, tags: ['tag3'] }
        ]
      };
      expect(validateNestedSchema(obj, schema)).toEqual([]);
    });
  });

  describe('Complex nested structures', () => {
    it('validates a deeply nested GraphQL-like response', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string', nullable: true },
              posts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    title: { type: 'string' },
                    comments: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'number' },
                          text: { type: 'string' },
                          author: { type: 'string', nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const response = {
        user: {
          id: 1,
          name: 'Alice',
          email: null,
          posts: [
            {
              id: 101,
              title: 'First Post',
              comments: [
                { id: 1001, text: 'Great!', author: 'Bob' },
                { id: 1002, text: 'Thanks!', author: null }
              ]
            }
          ]
        }
      };

      expect(validateNestedSchema(response, schema)).toEqual([]);
    });

    it('collects multiple errors across deeply nested structures', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                value: { type: 'string' }
              }
            }
          }
        }
      };

      const obj = {
        data: [
          { id: 1, value: 'hello' },
          { id: 'two', value: 100 },
          { id: 3 }
        ]
      };

      const errors = validateNestedSchema(obj, schema);
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect(errors.some(e => e.includes('[1].id'))).toBe(true);
      expect(errors.some(e => e.includes('[1].value'))).toBe(true);
      expect(errors.some(e => e.includes('[2].value'))).toBe(true);
    });

    it('supports optional and nullable fields in complex structures', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                label: { type: 'string', optional: true },
                metadata: { type: 'object', properties: { key: { type: 'string' } }, nullable: true, optional: true }
              }
            }
          }
        }
      };

      const valid1 = { items: [{ id: 1 }, { id: 2, label: 'item2' }] };
      const valid2 = { items: [{ id: 1, metadata: null }, { id: 2, metadata: { key: 'value' } }] };

      expect(validateNestedSchema(valid1, schema)).toEqual([]);
      expect(validateNestedSchema(valid2, schema)).toEqual([]);
    });
  });

  describe('Boundary cases', () => {
    it('handles empty arrays', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'string' } };
      expect(validateNestedSchema([], schema)).toEqual([]);
    });

    it('handles empty objects', () => {
      const schema: NestedSchema = { type: 'object', properties: {} };
      expect(validateNestedSchema({}, schema)).toEqual([]);
    });

    it('handles large arrays', () => {
      const schema: NestedSchema = { type: 'array', items: { type: 'number' } };
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      expect(validateNestedSchema(largeArray, schema)).toEqual([]);
    });

    it('validates with custom root path', () => {
      const schema: NestedSchema = { type: 'number' };
      const errors = validateNestedSchema('not-a-number', schema, 'response.data.value');
      expect(errors[0]).toContain('response.data.value');
    });

    it('handles unicode in string validation', () => {
      const schema: NestedSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };
      const obj = { name: '你好世界🌍' };
      expect(validateNestedSchema(obj, schema)).toEqual([]);
    });
  });
});
