/**
 * Schema Validator — Validates nested JSON structures with support for objects, arrays,
 * nullable fields, and optional fields. Provides path-based error messages.
 */

/** Primitive types recognised by {@link NestedSchema}. */
type PrimitiveType = 'string' | 'number' | 'boolean' | 'null';

/** Schema definition for a string field. */
export interface StringFieldSchema {
  type: 'string';
  nullable?: boolean;
  optional?: boolean;
}

/** Schema definition for a number field. */
export interface NumberFieldSchema {
  type: 'number';
  nullable?: boolean;
  optional?: boolean;
}

/** Schema definition for a boolean field. */
export interface BooleanFieldSchema {
  type: 'boolean';
  nullable?: boolean;
  optional?: boolean;
}

/** Schema definition for a null field. */
export interface NullFieldSchema {
  type: 'null';
  nullable?: boolean;
  optional?: boolean;
}

/** Schema definition for an object field with nested properties. */
export interface ObjectFieldSchema {
  type: 'object';
  properties: Record<string, NestedSchema>;
  nullable?: boolean;
  optional?: boolean;
}

/** Schema definition for an array field with homogeneous element type. */
export interface ArrayFieldSchema {
  type: 'array';
  items: NestedSchema;
  nullable?: boolean;
  optional?: boolean;
}

/** Union of all schema definition types. */
export type NestedSchema =
  | StringFieldSchema
  | NumberFieldSchema
  | BooleanFieldSchema
  | NullFieldSchema
  | ObjectFieldSchema
  | ArrayFieldSchema;

/** Classifies a parsed JSON value into a primitive type. */
function typeOfValue(value: unknown): PrimitiveType | 'array' | 'object' {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const jsType = typeof value;
  if (jsType === 'string' || jsType === 'number' || jsType === 'boolean' || jsType === 'object') {
    return jsType;
  }
  return 'null';
}

/**
 * Validates a parsed JSON value against a nested schema.
 * Collects all validation errors with full paths (e.g., "data.user.profile.age").
 *
 * @param value - The value to validate.
 * @param schema - The nested schema definition.
 * @param path - Current path in the JSON tree (used for error messages).
 * @returns A list of human-readable validation errors; empty when validation passes.
 */
export function validateNestedSchema(value: unknown, schema: NestedSchema, path = 'root'): string[] {
  const errors: string[] = [];

  // Handle null values
  if (value === null) {
    if (schema.type === 'null') {
      return errors;
    }
    if (!schema.nullable) {
      errors.push(`${path} (expected ${schema.type}, got null)`);
    }
    return errors;
  }

  // Handle undefined (missing) fields
  if (value === undefined) {
    if (!schema.optional) {
      errors.push(`${path} (missing required field)`);
    }
    return errors;
  }

  // Type-specific validation
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'boolean') {
    const actualType = typeOfValue(value);
    if (actualType !== schema.type) {
      errors.push(`${path} (expected ${schema.type}, got ${actualType})`);
    }
  } else if (schema.type === 'null') {
    errors.push(`${path} (expected null, got ${typeOfValue(value)})`);
  } else if (schema.type === 'object') {
    const actualType = typeOfValue(value);
    if (actualType !== 'object') {
      errors.push(`${path} (expected object, got ${actualType})`);
      return errors;
    }

    const record = value as Record<string, unknown>;
    for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
      const fieldPath = `${path}.${fieldName}`;
      const fieldValue = record[fieldName];

      const fieldErrors = validateNestedSchema(fieldValue, fieldSchema, fieldPath);
      errors.push(...fieldErrors);
    }
  } else if (schema.type === 'array') {
    const actualType = typeOfValue(value);
    if (actualType !== 'array') {
      errors.push(`${path} (expected array, got ${actualType})`);
      return errors;
    }

    const array = value as unknown[];
    for (let i = 0; i < array.length; i++) {
      const elementPath = `${path}[${i}]`;
      const elementErrors = validateNestedSchema(array[i], schema.items, elementPath);
      errors.push(...elementErrors);
    }
  }

  return errors;
}
