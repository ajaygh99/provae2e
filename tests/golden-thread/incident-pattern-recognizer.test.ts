import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  IncidentPatternRecognizer,
  incidentSignature,
  textSimilarity,
  type HistoricalIncident,
  type IncidentRootCause
} from '../../src/core/incident-pattern-recognizer.js';

const testDir = path.join(process.cwd(), '.test-incident-patterns');
let databaseIndex = 0;

function incident(overrides: Partial<HistoricalIncident> = {}): HistoricalIncident {
  databaseIndex += 1;
  return {
    id: `incident-${databaseIndex}`,
    goldenThreadId: `thread-${databaseIndex}`,
    errorMessage: 'SQL column customer_id does not exist',
    rootCause: 'CODE_BUG',
    occurredAt: '2026-06-01T00:00:00.000Z',
    resolvedAt: '2026-06-01T02:00:00.000Z',
    fixCommit: 'abc123',
    ...overrides
  };
}

async function store(): Promise<IncidentPatternRecognizer> {
  databaseIndex += 1;
  return IncidentPatternRecognizer.open(path.join(testDir, `patterns-${databaseIndex}.db`));
}

beforeAll(async () => rm(testDir, { recursive: true, force: true }));
afterAll(async () => rm(testDir, { recursive: true, force: true }));

describe('incident signatures and similarity', () => {
  it('normalizes volatile numbers', () => {
    expect(incidentSignature('Timeout after 1000 ms')).toBe(incidentSignature('Timeout after 5000 ms'));
  });

  it('normalizes UUID values', () => {
    expect(incidentSignature('Order 123e4567-e89b-12d3-a456-426614174000 failed'))
      .toBe(incidentSignature('Order 223e4567-e89b-12d3-a456-426614174111 failed'));
  });

  it('includes the first stack frame', () => {
    expect(incidentSignature('boom', 'at checkout.ts:42\nat next.ts:2')).toContain('checkout');
  });

  it('rejects an empty error message', () => {
    expect(() => incidentSignature(' ')).toThrow('errorMessage');
  });

  it('scores identical errors at one', () => {
    expect(textSimilarity('SQL connection failed', 'SQL connection failed')).toBe(1);
  });

  it('scores unrelated errors below similar errors', () => {
    expect(textSimilarity('SQL connection failed', 'SQL connection timeout'))
      .toBeGreaterThan(textSimilarity('SQL connection failed', 'CSS button color'));
  });

  it('scores two empty values at one', () => {
    expect(textSimilarity('', '')).toBe(1);
  });
});

describe('incident history persistence and matching', () => {
  it('persists and reloads an incident', async () => {
    const file = path.join(testDir, 'reload.db');
    const first = await IncidentPatternRecognizer.open(file);
    await first.recordIncident(incident({ id: 'reload' }));
    const reopened = await IncidentPatternRecognizer.open(file);
    expect(reopened.findSimilar('SQL column customer_id does not exist', undefined, 1)[0].id).toBe('reload');
  });

  it.each<IncidentRootCause>(['TEST_GAP', 'CODE_BUG', 'SPEC_GAP', 'DEPLOYMENT'])(
    'stores the %s root cause', async rootCause => {
      const recognizer = await store();
      await recognizer.recordIncident(incident({ rootCause }));
      expect(recognizer.report('2026-01-01', '2026-12-31').metrics.frequencyByRootCause[rootCause]).toBe(1);
    }
  );

  it('finds similar SQL incidents', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident());
    expect(recognizer.findSimilar('SQL column order_id does not exist')).toHaveLength(1);
  });

  it('uses stack traces in similarity', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: 'Unexpected failure', stackTrace: 'at checkout.ts:50' }));
    expect(recognizer.findSimilar('Unexpected failure', 'at checkout.ts:99', 0.7)).toHaveLength(1);
  });

  it('filters unrelated incidents', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident());
    expect(recognizer.findSimilar('CSS color mismatch', undefined, 0.8)).toEqual([]);
  });

  it('ranks the closest match first', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ id: 'close' }));
    await recognizer.recordIncident(incident({ id: 'far', errorMessage: 'Database connection timeout' }));
    expect(recognizer.findSimilar('SQL column customer_id does not exist')[0].id).toBe('close');
  });

  it('recommends the historical fix commit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T00:00:00Z'));
    const recognizer = await store();
    await recognizer.recordIncident(incident({ occurredAt: '2026-06-01T00:00:00Z', fixCommit: 'fix789' }));
    expect(recognizer.findSimilar('SQL column customer_id does not exist')[0].recommendation)
      .toBe('Similar incident 6 weeks ago, check fix in commit fix789');
    jest.useRealTimers();
  });

  it('supports recommendations without a known fix', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ fixCommit: undefined }));
    expect(recognizer.findSimilar('SQL column customer_id does not exist')[0].recommendation)
      .not.toContain('commit');
  });

  it.each([-0.1, 1.1, Number.NaN])('rejects invalid threshold %s', async threshold => {
    const recognizer = await store();
    expect(() => recognizer.findSimilar('error', undefined, threshold)).toThrow('threshold');
  });

  it('rejects duplicate incident identifiers', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ id: 'same' }));
    await expect(recognizer.recordIncident(incident({ id: 'same' }))).rejects.toThrow();
  });

  it.each([
    [{ id: '' }, 'id'],
    [{ goldenThreadId: '' }, 'goldenThreadId'],
    [{ errorMessage: '' }, 'errorMessage'],
    [{ occurredAt: 'bad' }, 'occurredAt'],
    [{ resolvedAt: '2026-05-01T00:00:00Z' }, 'resolvedAt']
  ])('validates invalid incident input', async (override, expected) => {
    const recognizer = await store();
    await expect(recognizer.recordIncident(incident(override))).rejects.toThrow(expected);
  });

  it('rejects an invalid runtime root cause', async () => {
    const recognizer = await store();
    await expect(recognizer.recordIncident(incident({ rootCause: 'OTHER' as IncidentRootCause })))
      .rejects.toThrow('rootCause');
  });
});

describe('pattern dashboard, prevention, and feedback', () => {
  it('groups matching normalized signatures', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: 'Timeout after 1000 ms' }));
    await recognizer.recordIncident(incident({ errorMessage: 'Timeout after 5000 ms' }));
    expect(recognizer.report('2026-01-01', '2026-12-31').topPatterns[0].frequency).toBe(2);
  });

  it('ranks patterns by frequency', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: 'Timeout after 1 ms' }));
    await recognizer.recordIncident(incident({ errorMessage: 'Timeout after 2 ms' }));
    await recognizer.recordIncident(incident({ errorMessage: 'Unauthorized token' }));
    expect(recognizer.report('2026-01-01', '2026-12-31').topPatterns[0].signature).toContain('timeout');
  });

  it('limits the top pattern list', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: 'SQL failed' }));
    await recognizer.recordIncident(incident({ errorMessage: 'Timeout failed' }));
    expect(recognizer.report('2026-01-01', '2026-12-31', 1).topPatterns).toHaveLength(1);
  });

  it('filters incidents outside the period', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ occurredAt: '2025-01-01', resolvedAt: undefined }));
    expect(recognizer.report('2026-01-01', '2026-12-31').metrics.totalIncidents).toBe(0);
  });

  it('reports frequency by root cause', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ rootCause: 'CODE_BUG' }));
    await recognizer.recordIncident(incident({ rootCause: 'TEST_GAP' }));
    const metrics = recognizer.report('2026-01-01', '2026-12-31').metrics;
    expect(metrics.frequencyByRootCause).toMatchObject({ CODE_BUG: 1, TEST_GAP: 1 });
  });

  it('calculates average resolution time and monthly trends', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident());
    await recognizer.recordIncident(incident({
      occurredAt: '2026-06-02T00:00:00Z', resolvedAt: '2026-06-02T04:00:00Z'
    }));
    const metrics = recognizer.report('2026-01-01', '2026-12-31').metrics;
    expect(metrics.averageResolutionMs).toBe(10_800_000);
    expect(metrics.resolutionTrend).toEqual([{ month: '2026-06', averageResolutionMs: 10_800_000, resolved: 2 }]);
  });

  it('omits resolution averages for unresolved incidents', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ resolvedAt: undefined }));
    expect(recognizer.report('2026-01-01', '2026-12-31').metrics.averageResolutionMs).toBeUndefined();
  });

  it.each([
    ['SQL column missing', 'schema changes'],
    ['Connection timed out', 'timeout'],
    ['Unauthorized token', 'token expiry'],
    ['Cannot read property of null', 'null']
  ])('creates rule-based prevention for %s', async (message, expected) => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: message }));
    expect(recognizer.report('2026-01-01', '2026-12-31').topPatterns[0].recommendation).toContain(expected);
  });

  it('creates a generic regression-test recommendation', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: 'Widget exploded' }));
    expect(recognizer.report('2026-01-01', '2026-12-31').topPatterns[0].suggestedTests[0])
      .toContain('regression test');
  });

  it('suggests schema migration scenarios for SQL failures', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident());
    expect(recognizer.report('2026-01-01', '2026-12-31').topPatterns[0].suggestedTests)
      .toContain('Test backward-compatible schema migration and rollback');
  });

  it('suggests bounded retry scenarios for timeout failures', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident({ errorMessage: 'Connection timeout' }));
    expect(recognizer.report('2026-01-01', '2026-12-31').topPatterns[0].suggestedTests)
      .toContain('Test dependency timeout with bounded retry');
  });

  it('tracks implemented recommendations across reloads', async () => {
    const file = path.join(testDir, 'feedback.db');
    const recognizer = await IncidentPatternRecognizer.open(file);
    const signature = await recognizer.recordIncident(incident({ id: 'feedback' }));
    expect(await recognizer.markRecommendationImplemented(signature)).toBe(1);
    const reopened = await IncidentPatternRecognizer.open(file);
    expect(reopened.report('2026-01-01', '2026-12-31').topPatterns[0].recommendationImplemented).toBe(true);
  });

  it('returns zero when feedback signature is unknown', async () => {
    const recognizer = await store();
    expect(await recognizer.markRecommendationImplemented('missing')).toBe(0);
  });

  it('validates feedback signatures', async () => {
    const recognizer = await store();
    await expect(recognizer.markRecommendationImplemented(' ')).rejects.toThrow('signature');
  });

  it.each([
    ['bad', '2026-12-31', 5, 'from'],
    ['2026-01-01', 'bad', 5, 'to'],
    ['2026-12-31', '2026-01-01', 5, 'before'],
    ['2026-01-01', '2026-12-31', 0, 'limit']
  ])('validates report inputs', async (from, to, limit, expected) => {
    const recognizer = await store();
    expect(() => recognizer.report(from, to, limit)).toThrow(expected);
  });

  it('reports the requested top-five headline', async () => {
    const recognizer = await store();
    await recognizer.recordIncident(incident());
    expect(recognizer.report('2026-01-01', '2026-12-31').headline)
      .toBe('Top 1 failure patterns for selected period');
  });
});
