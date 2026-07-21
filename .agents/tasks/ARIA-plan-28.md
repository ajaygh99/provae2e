# ARIA Plan — Issue #28: API Schema Validation Hardening

## Context
Current `validateSchema()` in `src/runners/api-runner.ts` only validates flat top-level objects. The request is to expand it to support:
- Nested objects
- Arrays (including homogeneous validation)
- Nullable fields
- Optional/required fields
- Clear path-based error messages (e.g., `data.user.profile.name`)
- Both REST and GraphQL responses

## Architecture Decision
Create a new `schema-validator.ts` module with:
1. **New schema type** supporting nested structures, nullability, optionality
2. **Path-based validation** that collects errors with full paths
3. **Array validation** with element type checking
4. **Backward compatibility** — wrap old API in new validator

## Files to Create/Modify
- **Create:** `src/core/schema-validator.ts` — Core validation engine
- **Create:** `tests/core/schema-validator.test.ts` — Comprehensive tests
- **Modify:** `src/runners/api-runner.ts` — Integrate new validator, keep old flat API for backward compat
- **Update:** `tests/api/api-runner.test.ts` — Add nested/nullable/optional tests

## Schema Format (TypeScript)
```typescript
export type NestedSchema = 
  | { type: 'string' | 'number' | 'boolean' | 'null'; nullable?: boolean; optional?: boolean }
  | { type: 'object'; properties: Record<string, NestedSchema>; nullable?: boolean; optional?: boolean }
  | { type: 'array'; items: NestedSchema; nullable?: boolean; optional?: boolean };
```

## Validation Flow
1. Start at root, walk tree recursively
2. On each field: check presence (if required), type, then recurse into children
3. Collect all path-based errors (e.g., `errors: ["data.user.profile.age (expected number, got string)"]`)
4. Return clear list of violations

## Test Coverage
- Happy path: valid nested structure passes
- Missing field: required field absent
- Wrong type: e.g., string where number expected
- Nullable fields: null is valid when nullable=true, invalid otherwise
- Optional fields: field absence is valid when optional=true, invalid otherwise
- Arrays: homogeneous element type checking
- Nested arrays: arrays of objects
- GraphQL data extraction: validate nested schema within GraphQL data field
- Boundary: deeply nested (3+ levels), large arrays
- Error messages: verify path-based formatting

## Acceptance Criteria
- ✅ Existing flat schema validation still works (backward compat)
- ✅ New nested schema validator handles objects, arrays, nullable, optional
- ✅ Path-based error messages (e.g., "data.user.age")
- ✅ Both REST and GraphQL responses validated
- ✅ TypeScript strict mode passes
- ✅ npm run lint passes
- ✅ 80%+ coverage on new code
- ✅ All tests pass

## FORGE Task
Implement `src/core/schema-validator.ts` with:
- `validateNestedSchema()` function accepting nested schema
- Support for nullable, optional, nested objects, arrays
- Path-based error collection
- Integrate into `runApiTest()` via new `nestedSchema` option

## VERA Task
Write comprehensive tests in `tests/core/schema-validator.test.ts`:
- Happy path: valid nested + nullable + optional
- All error conditions
- Boundary tests: deep nesting, large arrays
- GraphQL integration: validate nested schema within graphql.data
