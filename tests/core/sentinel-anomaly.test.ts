import {
  analyzeMetric,
  correlateCausation,
  detectDegradationTrend,
  detectPersistentAnomaly,
  isAnomalous,
  linearRegressionSlope,
  toDatadogSeries,
  toPrometheusMetrics,
  type AnomalyReport,
  type DailyValue,
  type SentinelExporter,
  type WindowObservation
} from '../../src/core/sentinel-anomaly.js';
import type { MetricSample, RollingBaseline, SentinelMetricName } from '../../src/core/sentinel-baseline.js';

const BASE_TIME = Date.parse('2026-07-23T12:00:00.000Z');

function baseline(metric: SentinelMetricName = 'p95LatencyMs', overrides: Partial<RollingBaseline> = {}): RollingBaseline {
  return {
    service: 'checkout',
    metric,
    mean: 100,
    stddev: 5,
    sampleSize: 10,
    windowDays: 7,
    ignoreWeekends: false,
    from: '2026-07-16T12:00:00.000Z',
    to: '2026-07-23T12:00:00.000Z',
    ...overrides
  };
}

/** Builds consecutive 5-minute windows from values (chronological). */
function windows(values: number[]): WindowObservation[] {
  return values.map((value, index) => ({
    value,
    timestamp: new Date(BASE_TIME + index * 5 * 60_000).toISOString()
  }));
}

/** Builds one-per-day values ending today. */
function daily(values: number[]): DailyValue[] {
  return values.map((value, index) => ({
    value,
    date: new Date(BASE_TIME - (values.length - 1 - index) * 86_400_000).toISOString()
  }));
}

/** History that yields mean=100, stddev=5 within the window. */
function history(metric: SentinelMetricName = 'p95LatencyMs'): MetricSample[] {
  return [95, 105, 95, 105].map((value, index) => ({
    service: 'checkout',
    metric,
    value,
    timestamp: new Date(BASE_TIME - (3 - index) * 86_400_000).toISOString()
  }));
}

describe('isAnomalous', () => {
  it('flags high-direction anomalies at exactly the threshold', () => {
    expect(isAnomalous(2, 'high')).toBe(true);
    expect(isAnomalous(1.99, 'high')).toBe(false);
  });

  it('flags low-direction (throughput drop) anomalies at exactly the threshold', () => {
    expect(isAnomalous(-2, 'low')).toBe(true);
    expect(isAnomalous(-1.99, 'low')).toBe(false);
  });

  it('rejects invalid inputs', () => {
    expect(() => isAnomalous(2, 'high', 0)).toThrow('threshold');
    expect(() => isAnomalous(Number.NaN, 'high')).toThrow('NaN');
  });
});

describe('detectPersistentAnomaly', () => {
  it('does not alert when no window is anomalous', () => {
    const result = detectPersistentAnomaly(windows([100, 101, 99]), baseline());
    expect(result.persistent).toBe(false);
    expect(result.maxConsecutiveAnomalies).toBe(0);
  });

  it('alerts at exactly two consecutive anomalous windows', () => {
    const result = detectPersistentAnomaly(windows([100, 110, 110]), baseline());
    expect(result.maxConsecutiveAnomalies).toBe(2);
    expect(result.persistent).toBe(true);
    expect(result.trailingConsecutiveAnomalies).toBe(2);
  });

  it('does not alert on a single isolated anomalous window', () => {
    const result = detectPersistentAnomaly(windows([100, 110, 99, 110]), baseline());
    expect(result.maxConsecutiveAnomalies).toBe(1);
    expect(result.persistent).toBe(false);
  });

  it('respects a custom requiredWindows threshold', () => {
    const result = detectPersistentAnomaly(windows([110, 110]), baseline(), { requiredWindows: 3 });
    expect(result.maxConsecutiveAnomalies).toBe(2);
    expect(result.persistent).toBe(false);
  });

  it('detects throughput drops (low direction)', () => {
    const result = detectPersistentAnomaly(windows([90, 90]), baseline('throughputRps'));
    expect(result.persistent).toBe(true);
    expect(result.windows[0].zScore).toBe(-2);
  });

  it('treats any deviation as anomalous when the baseline stddev is zero', () => {
    const result = detectPersistentAnomaly(windows([101, 101]), baseline('p95LatencyMs', { mean: 100, stddev: 0 }));
    expect(result.windows[0].zScore).toBe(Number.POSITIVE_INFINITY);
    expect(result.persistent).toBe(true);
  });

  it('rejects empty and invalid windows', () => {
    expect(() => detectPersistentAnomaly([], baseline())).toThrow('at least one window');
    expect(() => detectPersistentAnomaly([{ value: -1, timestamp: '2026-07-23T12:00:00.000Z' }], baseline())).toThrow('non-negative');
    expect(() => detectPersistentAnomaly([{ value: 1, timestamp: 'bad' }], baseline())).toThrow('timestamp');
    expect(() => detectPersistentAnomaly(windows([110, 110]), baseline(), { requiredWindows: 0 })).toThrow('requiredWindows');
  });
});

describe('linearRegressionSlope', () => {
  it('computes a positive slope for an increasing series', () => {
    expect(linearRegressionSlope([0, 1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('returns zero for a flat series', () => {
    expect(linearRegressionSlope([10, 10, 10])).toBe(0);
  });

  it('requires at least two values', () => {
    expect(() => linearRegressionSlope([1])).toThrow('at least two');
  });
});

describe('detectDegradationTrend', () => {
  it('confirms degradation after exactly five sustained days', () => {
    const result = detectDegradationTrend(daily([100, 110, 120, 130, 140, 150]), 'p95LatencyMs');
    expect(result.sustainedDays).toBe(5);
    expect(result.degrading).toBe(true);
    expect(result.slopePerDay).toBeGreaterThan(0);
  });

  it('does not confirm degradation after only four sustained days', () => {
    const result = detectDegradationTrend(daily([100, 110, 120, 130, 140]), 'p95LatencyMs');
    expect(result.sustainedDays).toBe(4);
    expect(result.degrading).toBe(false);
  });

  it('treats a day-over-day change of exactly +2% as qualifying', () => {
    const result = detectDegradationTrend(daily([100, 102]), 'p95LatencyMs', { minSustainedDays: 1 });
    expect(result.dailyPercentChanges[0]).toBe(2);
    expect(result.degrading).toBe(true);
  });

  it('does not qualify a +1% change below the 2% threshold', () => {
    const result = detectDegradationTrend(daily([100, 101]), 'p95LatencyMs', { minSustainedDays: 1 });
    expect(result.degrading).toBe(false);
  });

  it('detects sustained throughput decline (low direction)', () => {
    const result = detectDegradationTrend(daily([150, 140, 130, 120, 110, 100]), 'throughputRps');
    expect(result.sustainedDays).toBe(5);
    expect(result.degrading).toBe(true);
  });

  it('reports a flat series as non-degrading', () => {
    const result = detectDegradationTrend(daily([100, 100, 100, 100, 100, 100]), 'p95LatencyMs');
    expect(result.sustainedDays).toBe(0);
    expect(result.degrading).toBe(false);
  });

  it('rejects invalid trend input', () => {
    expect(() => detectDegradationTrend(daily([100]), 'p95LatencyMs')).toThrow('at least two');
    expect(() => detectDegradationTrend([{ date: 'bad', value: 1 }, { date: 'bad2', value: 2 }], 'p95LatencyMs')).toThrow('date');
    expect(() => detectDegradationTrend(daily([100, 110]), 'p95LatencyMs', { minDailyPercent: 0 })).toThrow('minDailyPercent');
    expect(() => detectDegradationTrend(daily([100, 110]), 'p95LatencyMs', { minSustainedDays: 1.5 })).toThrow('minSustainedDays');
  });
});

describe('correlateCausation', () => {
  const anomalyTime = new Date(BASE_TIME).toISOString();

  it('links to a deployment inside the lookback window', () => {
    const cause = correlateCausation(anomalyTime, {
      deployments: [{ sha: 'abc123', timestamp: new Date(BASE_TIME - 30 * 60_000).toISOString(), description: 'deploy X' }]
    });
    expect(cause.type).toBe('deployment');
    expect(cause.reference).toBe('abc123');
    expect(cause.minutesBefore).toBe(30);
    expect(cause.description).toBe('deploy X');
  });

  it('prefers the closest preceding cause', () => {
    const cause = correlateCausation(anomalyTime, {
      deployments: [
        { sha: 'old', timestamp: new Date(BASE_TIME - 55 * 60_000).toISOString() },
        { sha: 'new', timestamp: new Date(BASE_TIME - 10 * 60_000).toISOString() }
      ]
    });
    expect(cause.reference).toBe('new');
    expect(cause.minutesBefore).toBe(10);
  });

  it('links to a load spike when no deployment fits', () => {
    const cause = correlateCausation(anomalyTime, {
      loadSpikes: [{ timestamp: new Date(BASE_TIME - 5 * 60_000).toISOString(), magnitude: 3.2 }]
    });
    expect(cause.type).toBe('load-spike');
    expect(cause.description).toContain('3.2');
  });

  it('returns unknown when the cause is outside the lookback window', () => {
    const cause = correlateCausation(anomalyTime, {
      deployments: [{ sha: 'stale', timestamp: new Date(BASE_TIME - 120 * 60_000).toISOString() }]
    });
    expect(cause.type).toBe('unknown');
  });

  it('ignores causes that occur after the anomaly', () => {
    const cause = correlateCausation(anomalyTime, {
      deployments: [{ sha: 'future', timestamp: new Date(BASE_TIME + 10 * 60_000).toISOString() }]
    });
    expect(cause.type).toBe('unknown');
  });

  it('rejects invalid timestamps', () => {
    expect(() => correlateCausation('bad')).toThrow('anomaly timestamp');
    expect(() => correlateCausation(anomalyTime, { deployments: [{ sha: 'x', timestamp: 'bad' }] })).toThrow('deployment timestamp');
    expect(() => correlateCausation(anomalyTime, { lookbackMinutes: 0 })).toThrow('lookbackMinutes');
  });
});

describe('analyzeMetric', () => {
  it('raises and exports an alert for a persistent anomaly', async () => {
    const exporter = jest.fn<ReturnType<SentinelExporter>, Parameters<SentinelExporter>>(
      async () => ({ ok: true, target: 'prometheus' })
    );
    const report = await analyzeMetric(
      { service: 'checkout', metric: 'p95LatencyMs', history: history(), recentWindows: windows([100, 110, 110]) },
      { exporter }
    );
    expect(report.baseline.mean).toBe(100);
    expect(report.baseline.stddev).toBe(5);
    expect(report.currentZScore).toBe(2);
    expect(report.alert).toBe(true);
    expect(report.persistence.persistent).toBe(true);
    expect(exporter).toHaveBeenCalledTimes(1);
    expect(report.exported).toEqual({ ok: true, target: 'prometheus' });
    expect(report.summary).toContain('persisted');
  });

  it('does not export when there is no alert', async () => {
    const exporter = jest.fn<ReturnType<SentinelExporter>, Parameters<SentinelExporter>>(
      async () => ({ ok: true, target: 'prometheus' })
    );
    const report = await analyzeMetric(
      { service: 'checkout', metric: 'p95LatencyMs', history: history(), recentWindows: windows([100, 101, 99]) },
      { exporter }
    );
    expect(report.alert).toBe(false);
    expect(exporter).not.toHaveBeenCalled();
    expect(report.exported).toBeUndefined();
    expect(report.summary).toContain('No confirmed anomaly');
  });

  it('captures exporter failures without throwing', async () => {
    const exporter: SentinelExporter = async () => { throw new Error('sink offline'); };
    const report = await analyzeMetric(
      { service: 'checkout', metric: 'p95LatencyMs', history: history(), recentWindows: windows([110, 110]) },
      { exporter }
    );
    expect(report.exported).toEqual({ ok: false, target: 'exporter', detail: 'sink offline' });
  });

  it('alerts on a degradation trend even without a persistent window anomaly', async () => {
    const report = await analyzeMetric({
      service: 'checkout',
      metric: 'p95LatencyMs',
      history: history(),
      recentWindows: windows([100]),
      dailyValues: daily([100, 110, 120, 130, 140, 150])
    });
    expect(report.persistence.persistent).toBe(false);
    expect(report.trend?.degrading).toBe(true);
    expect(report.alert).toBe(true);
    expect(report.summary).toContain('gradual degradation');
  });

  it('attaches causation for an anomaly linked to a deployment', async () => {
    const report = await analyzeMetric({
      service: 'checkout',
      metric: 'p95LatencyMs',
      history: history(),
      recentWindows: windows([100, 110, 110]),
      deployments: [{ sha: 'deadbeef', timestamp: new Date(BASE_TIME + 5 * 60_000).toISOString() }]
    });
    // The latest window is the third (index 2), 10 minutes after BASE_TIME.
    expect(report.causation?.type).toBe('deployment');
    expect(report.causation?.reference).toBe('deadbeef');
    expect(report.summary).toContain('deployment deadbeef');
  });

  it('rejects empty windows and heterogeneous history', async () => {
    await expect(analyzeMetric({ service: 'checkout', metric: 'p95LatencyMs', history: history(), recentWindows: [] }))
      .rejects.toThrow('at least one recent window');
    await expect(analyzeMetric({
      service: 'other', metric: 'p95LatencyMs', history: history(), recentWindows: windows([100])
    })).rejects.toThrow('must match');
  });
});

describe('exporter formatters', () => {
  async function sampleReport(): Promise<AnomalyReport> {
    return analyzeMetric(
      { service: 'checkout', metric: 'p95LatencyMs', history: history(), recentWindows: windows([100, 110, 110]) }
    );
  }

  it('renders Prometheus exposition text', async () => {
    const text = toPrometheusMetrics(await sampleReport());
    expect(text).toContain('sentinel_metric_value{service="checkout",metric="p95LatencyMs"} 110');
    expect(text).toContain('sentinel_metric_alert{service="checkout",metric="p95LatencyMs"} 1');
  });

  it('renders Datadog series payloads', async () => {
    const series = toDatadogSeries(await sampleReport());
    expect(series).toHaveLength(2);
    expect(series[0].metric).toBe('sentinel.metric.value');
    expect(series[0].tags).toContain('service:checkout');
    expect(series[1].points[0][1]).toBe(1);
  });
});
