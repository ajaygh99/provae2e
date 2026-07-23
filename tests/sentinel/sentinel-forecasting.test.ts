import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelForecastingEngine,
  linearTrend,
  type ForecastActionExecutor,
  type ForecastActionResult,
  type ForecastPoint,
  type ForecastRule,
  type MetricForecast
} from '../../src/core/sentinel-forecasting.js';

const dir = path.join(process.cwd(), '.test-forecasting');
let sequence = 0;
const now = (): Date => new Date('2026-07-23T10:00:00Z');
const rule: ForecastRule = {
  id: 'disk-capacity',
  service: 'checkout',
  metric: 'disk_percent',
  threshold: 90,
  direction: 'above',
  proactiveAction: 'cleanup old logs and expand volume'
};

function points(values = [70, 75, 80]): ForecastPoint[] {
  return values.map((value, index) => ({
    timestamp: `2026-07-23T0${7 + index}:00:00Z`,
    value
  }));
}

class FakeExecutor implements ForecastActionExecutor {
  readonly calls: MetricForecast[] = [];
  async execute(_action: string, forecast: MetricForecast): Promise<ForecastActionResult> {
    this.calls.push(forecast);
    return { executed: true, detail: 'cleanup started' };
  }
}

async function engine(executor?: FakeExecutor): Promise<SentinelForecastingEngine> {
  sequence += 1;
  return SentinelForecastingEngine.open(path.join(dir, `${sequence}.db`), { executor, now });
}

beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('forecast model', () => {
  it('fits positive growth per hour', () => {
    expect(linearTrend(points()).growthPerHour).toBe(5);
  });

  it('fits negative growth per hour', () => {
    expect(linearTrend(points([80, 70, 60])).growthPerHour).toBe(-10);
  });

  it('fits flat trends', () => {
    expect(linearTrend(points([50, 50, 50])).growthPerHour).toBe(0);
  });

  it('supports irregular sample intervals', () => {
    const result = linearTrend([
      { timestamp: '2026-07-23T07:00:00Z', value: 10 },
      { timestamp: '2026-07-23T07:30:00Z', value: 15 },
      { timestamp: '2026-07-23T09:00:00Z', value: 30 }
    ]);
    expect(result.growthPerHour).toBe(10);
  });

  it.each([
    [[], 'three'],
    [[{ timestamp: 'bad', value: 1 }, ...points().slice(0, 2)], 'timestamp'],
    [[{ timestamp: '2026-07-23T07:00:00Z', value: Number.NaN }, ...points().slice(1)], 'value'],
    [[points()[0], points()[0], points()[2]], 'chronological']
  ])('validates points', (input, message) => {
    expect(() => linearTrend(input as ForecastPoint[])).toThrow(message);
  });
});

describe('predictive alerts', () => {
  it('produces 1, 4, and 24 hour forecasts', async () => {
    const run = await (await engine()).forecast(rule, points());
    expect(run.forecasts.map(item => item.horizonHours)).toEqual([1, 4, 24]);
  });

  it('predicts values at each horizon', async () => {
    const run = await (await engine()).forecast(rule, points());
    expect(run.forecasts.map(item => item.predictedValue)).toEqual([85, 100, 200]);
  });

  it('predicts a breach in four hours', async () => {
    const forecast = (await (await engine()).forecast(rule, points())).forecasts[1];
    expect(forecast?.predictedBreach).toBe(true);
    expect(forecast?.predictedBreachAt).toBe('2026-07-23T11:00:00.000Z');
  });

  it('does not alert when horizon is before breach', async () => {
    const forecast = (await (await engine()).forecast(rule, points())).forecasts[0];
    expect(forecast?.predictedBreach).toBe(false);
    expect(forecast?.alert).toBeUndefined();
  });

  it('creates proactive alert text', async () => {
    const forecast = (await (await engine()).forecast(rule, points())).forecasts[1];
    expect(forecast?.alert).toContain('will breach 90');
    expect(forecast?.alert).toContain('current growth rate');
  });

  it('includes preventive recommendation', async () => {
    const forecast = (await (await engine()).forecast(rule, points())).forecasts[1];
    expect(forecast?.recommendation).toContain('cleanup');
  });

  it('supports below-threshold forecasts', async () => {
    const lowRule: ForecastRule = { ...rule, threshold: 20, direction: 'below' };
    const run = await (await engine()).forecast(lowRule, points([40, 30, 25]));
    expect(run.forecasts[0]?.predictedBreach).toBe(true);
  });

  it('does not predict when trend moves away from threshold', async () => {
    const run = await (await engine()).forecast(rule, points([80, 75, 70]));
    expect(run.forecasts.every(item => !item.predictedBreach)).toBe(true);
  });

  it('detects an already-breached threshold', async () => {
    const run = await (await engine()).forecast(rule, points([90, 92, 95]));
    expect(run.forecasts[0]?.predictedBreachAt).toBe('2026-07-23T10:00:00.000Z');
  });

  it('does not forecast breach for a flat safe metric', async () => {
    const run = await (await engine()).forecast(rule, points([50, 50, 50]));
    expect(run.forecasts.every(item => !item.predictedBreach)).toBe(true);
  });

  it('triggers proactive automation once using earliest breach', async () => {
    const executor = new FakeExecutor();
    const run = await (await engine(executor)).forecast(rule, points());
    expect(executor.calls).toHaveLength(1);
    expect(run.actionResults[0]?.executed).toBe(true);
    expect(executor.calls[0]?.horizonHours).toBe(4);
  });

  it('does not automate when no breach is predicted', async () => {
    const executor = new FakeExecutor();
    await (await engine(executor)).forecast(rule, points([50, 50, 50]));
    expect(executor.calls).toHaveLength(0);
  });

  it('works without an action executor', async () => {
    expect((await (await engine()).forecast(rule, points())).actionResults).toHaveLength(0);
  });

  it.each([
    [{ id: '' }, 'rule.id'],
    [{ service: '' }, 'rule.service'],
    [{ metric: '' }, 'rule.metric'],
    [{ proactiveAction: '' }, 'rule.proactiveAction'],
    [{ threshold: Number.NaN }, 'rule.threshold'],
    [{ direction: 'sideways' as 'above' }, 'rule.direction']
  ])('validates forecast rules', async (overrides, message) => {
    await expect((await engine()).forecast({ ...rule, ...overrides }, points())).rejects.toThrow(message);
  });

  it('persists and retrieves forecasts', async () => {
    const value = await engine();
    const created = (await value.forecast(rule, points())).forecasts[0] as MetricForecast;
    expect(value.getForecast(created.id)).toEqual(created);
  });

  it('returns undefined for unknown forecasts', async () => {
    expect((await engine()).getForecast('missing')).toBeUndefined();
  });

  it('surfaces database read errors', async () => {
    const databasePath = path.join(dir, 'directory.db');
    await mkdir(databasePath, { recursive: true });
    await expect(SentinelForecastingEngine.open(databasePath)).rejects.toThrow();
  });

  it('rejects an invalid clock', async () => {
    const value = await SentinelForecastingEngine.open(path.join(dir, 'clock.db'), {
      now: () => new Date('invalid')
    });
    await expect(value.forecast(rule, points())).rejects.toThrow('Current time');
  });
});

describe('forecast learning feedback', () => {
  it('records feedback and calculates MAE', async () => {
    const value = await engine();
    const forecast = (await value.forecast(rule, points())).forecasts[0] as MetricForecast;
    await value.recordFeedback({
      forecastId: forecast.id,
      actualValue: 87,
      actualTimestamp: '2026-07-23T10:00:00Z',
      actualBreached: false
    });
    expect(value.accuracy().meanAbsoluteError).toBe(2);
  });

  it('calculates RMSE across outcomes', async () => {
    const value = await engine();
    const forecasts = (await value.forecast(rule, points())).forecasts;
    await value.recordFeedback({ forecastId: forecasts[0]?.id as string, actualValue: 87, actualTimestamp: '2026-07-23T10:00:00Z', actualBreached: false });
    await value.recordFeedback({ forecastId: forecasts[1]?.id as string, actualValue: 104, actualTimestamp: '2026-07-23T11:00:00Z', actualBreached: true });
    expect(value.accuracy().rootMeanSquaredError).toBeCloseTo(3.1623, 3);
  });

  it('calculates false positive rate', async () => {
    const value = await engine();
    const forecasts = (await value.forecast(rule, points())).forecasts;
    await value.recordFeedback({ forecastId: forecasts[1]?.id as string, actualValue: 89, actualTimestamp: '2026-07-23T11:00:00Z', actualBreached: false });
    await value.recordFeedback({ forecastId: forecasts[2]?.id as string, actualValue: 95, actualTimestamp: '2026-07-24T09:00:00Z', actualBreached: true });
    expect(value.accuracy().falsePositiveRate).toBe(50);
  });

  it('calculates detection latency', async () => {
    const value = await engine();
    const forecast = (await value.forecast(rule, points())).forecasts[1] as MetricForecast;
    await value.recordFeedback({
      forecastId: forecast.id,
      actualValue: 91,
      actualTimestamp: '2026-07-23T11:15:00Z',
      actualBreached: true
    });
    expect(value.accuracy().averageDetectionLatencyMinutes).toBe(15);
  });

  it('returns zero metrics without feedback', async () => {
    expect((await engine()).accuracy()).toEqual({
      sampleCount: 0,
      meanAbsoluteError: 0,
      rootMeanSquaredError: 0,
      falsePositiveRate: 0,
      averageDetectionLatencyMinutes: 0
    });
  });

  it('supports accuracy filtered by rule', async () => {
    const value = await engine();
    const forecast = (await value.forecast(rule, points())).forecasts[0] as MetricForecast;
    await value.recordFeedback({ forecastId: forecast.id, actualValue: 85, actualTimestamp: '2026-07-23T10:00:00Z', actualBreached: false });
    expect(value.accuracy(rule.id).sampleCount).toBe(1);
    expect(value.accuracy('other').sampleCount).toBe(0);
  });

  it('updates feedback for retraining', async () => {
    const value = await engine();
    const forecast = (await value.forecast(rule, points())).forecasts[0] as MetricForecast;
    const base = { forecastId: forecast.id, actualTimestamp: '2026-07-23T10:00:00Z', actualBreached: false };
    await value.recordFeedback({ ...base, actualValue: 100 });
    await value.recordFeedback({ ...base, actualValue: 85 });
    expect(value.accuracy().meanAbsoluteError).toBe(0);
  });

  it('rejects unknown forecast feedback', async () => {
    await expect((await engine()).recordFeedback({
      forecastId: 'missing',
      actualValue: 1,
      actualTimestamp: '2026-07-23T10:00:00Z',
      actualBreached: false
    })).rejects.toThrow('Unknown forecast');
  });

  it.each([
    [{ forecastId: '' }, 'forecastId'],
    [{ actualValue: Number.NaN }, 'actualValue'],
    [{ actualTimestamp: 'bad' }, 'actualTimestamp']
  ])('validates feedback', async (overrides, message) => {
    const value = await engine();
    const forecast = (await value.forecast(rule, points())).forecasts[0] as MetricForecast;
    await expect(value.recordFeedback({
      forecastId: forecast.id,
      actualValue: 1,
      actualTimestamp: '2026-07-23T10:00:00Z',
      actualBreached: false,
      ...overrides
    })).rejects.toThrow(message);
  });

  it('persists feedback across reopen', async () => {
    const file = path.join(dir, 'persist.db');
    const first = await SentinelForecastingEngine.open(file, { now });
    const forecast = (await first.forecast(rule, points())).forecasts[0] as MetricForecast;
    await first.recordFeedback({ forecastId: forecast.id, actualValue: 85, actualTimestamp: '2026-07-23T10:00:00Z', actualBreached: false });
    const reopened = await SentinelForecastingEngine.open(file, { now });
    expect(reopened.accuracy().sampleCount).toBe(1);
  });
});
