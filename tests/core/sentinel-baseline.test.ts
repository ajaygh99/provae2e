import {
  SENTINEL_METRICS,
  SENTINEL_METRIC_DIRECTION,
  computeRollingBaseline,
  mean,
  populationStddev,
  validateMetricSample,
  zScore,
  type MetricSample,
  type SentinelMetricName
} from '../../src/core/sentinel-baseline.js';

function sample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    service: 'checkout',
    metric: 'p95LatencyMs',
    value: 100,
    timestamp: '2026-07-20T12:00:00.000Z',
    ...overrides
  };
}

/** Builds daily samples ending at `end`, one per day going back `count` days. */
function series(values: number[], end = '2026-07-23T12:00:00.000Z', metric: SentinelMetricName = 'p95LatencyMs'): MetricSample[] {
  const endTime = Date.parse(end);
  return values.map((value, index) => sample({
    metric,
    value,
    timestamp: new Date(endTime - (values.length - 1 - index) * 86_400_000).toISOString()
  }));
}

describe('statistics helpers', () => {
  it('computes mean and population stddev', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(populationStddev([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });

  it('throws on empty input', () => {
    expect(() => mean([])).toThrow('at least one');
    expect(() => populationStddev([])).toThrow('at least one');
  });

  it('computes signed z-scores', () => {
    expect(zScore(110, 100, 5)).toBe(2);
    expect(zScore(90, 100, 5)).toBe(-2);
  });

  it('returns infinities when stddev is zero', () => {
    expect(zScore(101, 100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(zScore(99, 100, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(zScore(100, 100, 0)).toBe(0);
  });

  it('rejects invalid z-score inputs', () => {
    expect(() => zScore(Number.NaN, 100, 5)).toThrow('finite');
    expect(() => zScore(100, 100, -1)).toThrow('non-negative');
  });

  it('exposes all seven metrics with a direction', () => {
    expect(SENTINEL_METRICS).toHaveLength(7);
    expect(SENTINEL_METRIC_DIRECTION.throughputRps).toBe('low');
    expect(SENTINEL_METRIC_DIRECTION.p99LatencyMs).toBe('high');
  });
});

describe('validateMetricSample', () => {
  it('accepts a valid sample', () => {
    expect(() => validateMetricSample(sample())).not.toThrow();
  });

  it.each<[Partial<MetricSample>, string]>([
    [{ service: '  ' }, 'service'],
    [{ metric: 'bogus' as SentinelMetricName }, 'Unsupported'],
    [{ timestamp: 'not-a-date' }, 'timestamp'],
    [{ value: -1 }, 'non-negative'],
    [{ metric: 'errorRate', value: 1.5 }, 'errorRate'],
    [{ metric: 'cpuPercent', value: 150 }, 'cpuPercent']
  ])('rejects invalid sample %#', (override, expected) => {
    expect(() => validateMetricSample(sample(override))).toThrow(expected);
  });
});

describe('computeRollingBaseline', () => {
  it('computes mean and stddev over the 7-day window', () => {
    const baseline = computeRollingBaseline(series([100, 100, 100, 100, 130]));
    expect(baseline.service).toBe('checkout');
    expect(baseline.metric).toBe('p95LatencyMs');
    expect(baseline.sampleSize).toBe(5);
    expect(baseline.windowDays).toBe(7);
    expect(baseline.mean).toBeCloseTo(106, 10);
    expect(baseline.stddev).toBeGreaterThan(0);
  });

  it('defaults the reference time to the newest sample', () => {
    const baseline = computeRollingBaseline(series([100, 110]));
    expect(baseline.to).toBe('2026-07-23T12:00:00.000Z');
  });

  it('excludes samples outside the rolling window', () => {
    const old = sample({ value: 999, timestamp: '2026-07-01T12:00:00.000Z' });
    const recent = series([100, 100, 100]);
    const baseline = computeRollingBaseline([old, ...recent], { now: new Date('2026-07-23T12:00:00.000Z') });
    expect(baseline.sampleSize).toBe(3);
    expect(baseline.mean).toBe(100);
  });

  it('optionally ignores weekend samples', () => {
    // 2026-07-18 is Saturday, 2026-07-19 is Sunday (UTC).
    const samples: MetricSample[] = [
      sample({ value: 100, timestamp: '2026-07-17T12:00:00.000Z' }),
      sample({ value: 500, timestamp: '2026-07-18T12:00:00.000Z' }),
      sample({ value: 500, timestamp: '2026-07-19T12:00:00.000Z' }),
      sample({ value: 100, timestamp: '2026-07-20T12:00:00.000Z' })
    ];
    const withWeekends = computeRollingBaseline(samples, { now: new Date('2026-07-20T12:00:00.000Z') });
    const without = computeRollingBaseline(samples, { now: new Date('2026-07-20T12:00:00.000Z'), ignoreWeekends: true });
    expect(withWeekends.sampleSize).toBe(4);
    expect(without.sampleSize).toBe(2);
    expect(without.mean).toBe(100);
  });

  it('throws when no samples are provided', () => {
    expect(() => computeRollingBaseline([])).toThrow('at least one sample');
  });

  it('throws on heterogeneous samples', () => {
    expect(() => computeRollingBaseline([sample(), sample({ service: 'other' })])).toThrow('single service and metric');
    expect(() => computeRollingBaseline([sample(), sample({ metric: 'errorRate', value: 0.1 })])).toThrow('single service and metric');
  });

  it('throws when too few samples fall inside the window', () => {
    expect(() => computeRollingBaseline(series([100, 100]), { minimumSamples: 5 })).toThrow('At least 5');
  });

  it.each([0, -1, Number.NaN])('rejects a non-positive window of %s days', (windowDays) => {
    expect(() => computeRollingBaseline(series([100, 100]), { windowDays })).toThrow('windowDays');
  });

  it('rejects a non-integer minimumSamples', () => {
    expect(() => computeRollingBaseline(series([100, 100]), { minimumSamples: 1.5 })).toThrow('minimumSamples');
  });
});
