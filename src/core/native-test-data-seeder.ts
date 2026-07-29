export type NativeSeedValue = string | number | boolean | null;
export type NativeSeedRecord = Record<string, NativeSeedValue>;

export interface NativeSeedFixture {
  id: string;
  tables: Record<string, NativeSeedRecord[]>;
}

export interface NativeSeedAdapter {
  apply(fixture: NativeSeedFixture): Promise<void>;
  verify(fixture: NativeSeedFixture): Promise<boolean>;
  cleanup(fixtureId: string): Promise<void>;
}

const SAFE_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_FIXTURE_BYTES = 1024 * 1024;
const MAX_RECORDS = 10_000;

export function validateNativeSeedFixture(fixture: NativeSeedFixture): NativeSeedFixture {
  if (!SAFE_NAME.test(fixture.id)) {
    throw new Error('Native seed fixture ID must be a safe 1 to 64 character identifier');
  }
  const serialized = JSON.stringify(fixture);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FIXTURE_BYTES) {
    throw new Error('Native seed fixture exceeds the 1 MiB limit');
  }
  const tableEntries = Object.entries(fixture.tables);
  if (tableEntries.length === 0 || tableEntries.length > 100) {
    throw new Error('Native seed fixture must contain between 1 and 100 tables');
  }
  let records = 0;
  for (const [table, rows] of tableEntries) {
    if (!SAFE_NAME.test(table) || BLOCKED_KEYS.has(table)) {
      throw new Error(`Invalid native seed table: ${table}`);
    }
    records += rows.length;
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (!SAFE_NAME.test(key) || BLOCKED_KEYS.has(key)) {
          throw new Error(`Invalid native seed field: ${key}`);
        }
        if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
          throw new Error(`Invalid native seed value for ${table}.${key}`);
        }
        if (typeof value === 'string' && value.length > 10_000) {
          throw new Error(`Native seed string is too long for ${table}.${key}`);
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
          throw new Error(`Native seed number must be finite for ${table}.${key}`);
        }
      }
    }
  }
  if (records === 0 || records > MAX_RECORDS) {
    throw new Error('Native seed fixture must contain between 1 and 10000 records');
  }
  return JSON.parse(serialized) as NativeSeedFixture;
}

/** Applies and verifies isolated data, then guarantees cleanup after the operation. */
export async function withNativeSeedData<T>(
  adapter: NativeSeedAdapter,
  fixture: NativeSeedFixture,
  operation: () => Promise<T>
): Promise<T> {
  const validated = validateNativeSeedFixture(fixture);
  await adapter.apply(validated);
  if (!await adapter.verify(validated)) {
    await adapter.cleanup(validated.id);
    throw new Error('Native seed verification failed');
  }
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await adapter.cleanup(validated.id);
    } catch (cleanupError) {
      if (operationError === undefined) {
        throw new Error(`Native seed cleanup failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`);
      }
    }
  }
}
