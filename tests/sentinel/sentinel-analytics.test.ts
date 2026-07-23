import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SentinelAnalyticsEngine, type AnalyticsIncident } from '../../src/core/sentinel-analytics';

const base: AnalyticsIncident[] = [
  {
    id: 'api-1', occurredAt: '2026-05-01T10:00:00Z', service: 'checkout',
    summary: 'database connection timeout during checkout', metrics: { latency: 900 },
    severity: 4, resolution: 'Increase database connection pool', outcome: 'resolved'
  },
  {
    id: 'api-2', occurredAt: '2026-05-08T11:00:00Z', service: 'checkout',
    summary: 'checkout database connection timeout', metrics: { latency: 1200 },
    severity: 5, resolution: 'Increase database connection pool', outcome: 'resolved'
  },
  {
    id: 'queue-1', occurredAt: '2026-05-03T02:00:00Z', service: 'worker',
    summary: 'message queue backlog exhausted workers', metrics: { queue: 5000 },
    severity: 3, resolution: 'Scale worker replicas', outcome: 'mitigated'
  }
];

describe('SentinelAnalyticsEngine', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'sentinel-analytics-'));
    file = path.join(directory, 'model.json');
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('clusters incidents, versions the model, and persists performance metrics', async () => {
    const engine = await SentinelAnalyticsEngine.open(file, { now: () => new Date('2026-05-15T00:00:00Z') });
    const version = await engine.learn(base);
    expect(version).toMatchObject({ incidentCount: 3, clusterCount: 2 });
    expect(version?.silhouetteScore).toBeGreaterThan(0);
    expect(engine.clusters().find(item => item.incidentIds.includes('api-1'))?.incidentIds).toContain('api-2');
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty('versions.0.version');
  });

  it('recommends the resolution of a similar incident with explainability', async () => {
    const now = new Date('2026-06-12T00:00:00Z');
    const engine = await SentinelAnalyticsEngine.open(file, { now: () => now });
    await engine.learn(base);
    const result = engine.analyze({
      id: 'new', occurredAt: '2026-06-12T10:00:00Z', service: 'checkout',
      summary: 'database connection timeout in checkout', metrics: { latency: 1500 }, severity: 5
    });
    expect(result.anomaly).toBe(false);
    expect(result.priorityScore).toBeGreaterThan(70);
    expect(result.recommendation).toMatchObject({
      action: 'Increase database connection pool',
      similarIncidentId: 'api-2'
    });
    expect(result.recommendation?.explanation).toContain('Based on 2 similar incidents');
    expect(result.recommendation?.explanation).toContain('5 weeks ago');
  });

  it('detects a novel incident and gives severity-weighted priority', async () => {
    const engine = await SentinelAnalyticsEngine.open(file, {
      now: () => new Date('2026-05-15T00:00:00Z'), anomalyThreshold: 0.7
    });
    await engine.learn(base);
    const result = engine.analyze({
      id: 'novel', occurredAt: '2026-05-15T20:00:00Z', service: 'identity',
      summary: 'certificate cryptographic signature rejected', severity: 5
    });
    expect(result.anomaly).toBe(true);
    expect(result.anomalyScore).toBeGreaterThanOrEqual(0.7);
    expect(result.priorityScore).toBeGreaterThan(80);
    expect(result.explanation).toContain('Novel incident');
  });

  it('retrain occurs weekly, but not before the interval', async () => {
    let current = new Date('2026-05-15T00:00:00Z');
    const engine = await SentinelAnalyticsEngine.open(file, { now: () => current });
    expect(await engine.learn(base)).toBeDefined();
    current = new Date('2026-05-20T00:00:00Z');
    expect(await engine.learn([])).toBeUndefined();
    current = new Date('2026-05-22T00:00:00Z');
    expect(await engine.learn([])).toMatchObject({ incidentCount: 3 });
    expect(engine.versions()).toHaveLength(2);
  });

  it('loads persisted models and keeps only six months of training history', async () => {
    const old = { ...base[0], id: 'old', occurredAt: '2025-01-01T00:00:00Z' };
    const engine = await SentinelAnalyticsEngine.open(file, { now: () => new Date('2026-05-15T00:00:00Z') });
    await engine.learn([...base, old]);
    const reopened = await SentinelAnalyticsEngine.open(file, { now: () => new Date('2026-05-15T00:00:00Z') });
    expect(reopened.versions()[0].incidentCount).toBe(3);
    expect(reopened.clusters().flatMap(item => item.incidentIds)).not.toContain('old');
  });

  it.each([
    [{ ...base[0], id: '' }, 'incident.id is required'],
    [{ ...base[0], occurredAt: 'invalid' }, 'incident.occurredAt must be valid'],
    [{ ...base[0], metrics: { bad: Number.NaN } }, 'incident metrics must be finite']
  ])('validates malformed incidents', async (incident, message) => {
    const engine = await SentinelAnalyticsEngine.open(file);
    await expect(engine.learn([incident as AnalyticsIncident])).rejects.toThrow(message);
  });

  it('validates model options and the clock', async () => {
    await expect(SentinelAnalyticsEngine.open(file, { similarityThreshold: 2 })).rejects.toThrow('between 0 and 1');
    await expect(SentinelAnalyticsEngine.open(file, { anomalyThreshold: Number.NaN })).rejects.toThrow('between 0 and 1');
    await expect(SentinelAnalyticsEngine.open(file, { retentionDays: 0 })).rejects.toThrow('positive integer');
    const engine = await SentinelAnalyticsEngine.open(file, { now: () => new Date('invalid') });
    await expect(engine.learn([])).rejects.toThrow('Current time must be valid');
  });

  it('explains an empty model without inventing a recommendation', async () => {
    const engine = await SentinelAnalyticsEngine.open(file, {
      now: () => new Date('2026-05-15T00:00:00Z')
    });
    const result = engine.analyze({
      id: 'first', occurredAt: '2026-05-15T00:00:00Z', service: 'api',
      summary: 'first observed failure', severity: 1
    });
    expect(result).toMatchObject({ anomaly: true, anomalyScore: 1 });
    expect(result.clusterId).toBeUndefined();
    expect(result.recommendation).toBeUndefined();
  });

  it.each([
    [{ ...base[0], service: '' }, 'incident.service is required'],
    [{ ...base[0], summary: '' }, 'incident.summary is required'],
    [{ ...base[0], severity: 0 }, 'incident.severity must be between 1 and 5']
  ])('validates all required incident features', async (incident, message) => {
    const engine = await SentinelAnalyticsEngine.open(file);
    expect(() => engine.analyze(incident as AnalyticsIncident)).toThrow(message);
  });
});
