import {
  analyzeRegressionTrend,
  calculateMetricBaseline,
  type RegressionJiraIssue,
  type TrendMetrics,
  type TrendRun
} from '../../src/core/regression-trend-analyzer.js';

const DAY = 86_400_000;
const NOW = new Date('2026-07-23T12:00:00.000Z');
const BASE: TrendMetrics = {
  durationMs: 1000,
  errorRate: 0.01,
  memoryMb: 100,
  cpuPercent: 20,
  networkBytes: 1000
};

function run(daysAgo: number, metrics: Partial<TrendMetrics> = {}, testId = 'checkout'): TrendRun {
  return {
    testId,
    timestamp: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    metrics: { ...BASE, ...metrics }
  };
}

function stableHistory(count = 8): TrendRun[] {
  return Array.from({ length: count }, (_, index) => run(count - index, {
    durationMs: 995 + (index % 3) * 5,
    memoryMb: 99 + (index % 3),
    cpuPercent: 19 + (index % 3),
    networkBytes: 995 + (index % 3) * 5
  }));
}

describe('Golden Thread regression trend analysis', () => {
  describe('rolling baseline statistics', () => {
    it('calculates mean, median, and population standard deviation', () => {
      const baseline = calculateMetricBaseline([1, 2, 3]);
      expect(baseline.mean).toBe(2);
      expect(baseline.median).toBe(2);
      expect(baseline.stddev).toBeCloseTo(Math.sqrt(2 / 3));
      expect(baseline.sampleSize).toBe(3);
    });

    it('excludes one-off high outliers using IQR', () => {
      const baseline = calculateMetricBaseline([10, 10, 10, 11, 11, 1000]);
      expect(baseline.excludedOutliers).toBe(1);
      expect(baseline.mean).toBeCloseTo(10.4);
    });

    it('excludes one-off low outliers using IQR', () => {
      const baseline = calculateMetricBaseline([0, 100, 100, 100, 101, 101]);
      expect(baseline.excludedOutliers).toBe(1);
      expect(baseline.mean).toBeCloseTo(100.4);
    });

    it('keeps small samples rather than over-filtering them', () => {
      expect(calculateMetricBaseline([1, 2, 100]).sampleSize).toBe(3);
    });

    it('rejects an empty baseline', () => {
      expect(() => calculateMetricBaseline([])).toThrow('At least one finite baseline value');
    });

    it('ignores non-finite baseline inputs', () => {
      expect(calculateMetricBaseline([1, Number.NaN, 3]).mean).toBe(2);
    });
  });

  describe('30-day rolling analysis', () => {
    it('uses only matching tests inside the rolling window', async () => {
      const history = [...stableHistory(5), run(31, { durationMs: 50_000 }), run(2, { durationMs: 50_000 }, 'other')];
      const report = await analyzeRegressionTrend(history, run(0), { now: NOW });
      const duration = report.assessments.find(item => item.metric === 'durationMs');
      expect(duration?.baseline.mean).toBeCloseTo(999);
      expect(duration?.baseline.sampleSize).toBe(5);
    });

    it('reports all Datadog resource metrics', async () => {
      const report = await analyzeRegressionTrend(stableHistory(), run(0), { now: NOW });
      expect(report.assessments.map(item => item.metric)).toEqual([
        'durationMs', 'errorRate', 'memoryMb', 'cpuPercent', 'networkBytes'
      ]);
    });

    it('records the exact rolling window boundaries', async () => {
      const report = await analyzeRegressionTrend(stableHistory(), run(0), { now: NOW });
      expect(report.baselineFrom).toBe(new Date(NOW.getTime() - 30 * DAY).toISOString());
      expect(report.baselineTo).toBe(NOW.toISOString());
    });

    it('requires enough baseline samples', async () => {
      await expect(analyzeRegressionTrend(stableHistory(4), run(0), { now: NOW }))
        .rejects.toThrow('At least 5 historical runs');
    });

    it('supports a configurable minimum sample count and window', async () => {
      const report = await analyzeRegressionTrend(stableHistory(3), run(0), {
        now: NOW, minimumBaselineSamples: 3, baselineWindowDays: 10
      });
      expect(report.baselineWindowDays).toBe(10);
    });

    it('does not flag an improvement as a regression', async () => {
      const report = await analyzeRegressionTrend(stableHistory(), run(0, { durationMs: 500 }), { now: NOW });
      expect(report.assessments[0].unusual).toBe(false);
      expect(report.confirmed).toBe(false);
    });

    it('handles a zero-variance baseline', async () => {
      const history = Array.from({ length: 6 }, (_, index) => run(7 - index));
      const report = await analyzeRegressionTrend(history, run(0, { durationMs: 2000 }), { now: NOW });
      expect(report.assessments[0].zScore).toBe(Number.POSITIVE_INFINITY);
      expect(report.assessments[0].unusual).toBe(true);
    });
  });

  describe('confirmation and reporting', () => {
    const consecutiveHistory = (): TrendRun[] => [
      ...Array.from({ length: 6 }, (_, index) => run(12 - index)),
      run(1, { durationMs: 5000 })
    ];

    it('marks a z-score over two as unusual', async () => {
      const report = await analyzeRegressionTrend(consecutiveHistory(), run(0, { durationMs: 6000 }), { now: NOW });
      expect(report.assessments[0].zScore).toBeGreaterThan(2);
      expect(report.assessments[0].unusual).toBe(true);
    });

    it('confirms two consecutive duration regressions', async () => {
      const report = await analyzeRegressionTrend(consecutiveHistory(), run(0, { durationMs: 6000 }), { now: NOW });
      expect(report.assessments[0].consecutiveRegressions).toBe(2);
      expect(report.assessments[0].confirmed).toBe(true);
      expect(report.confirmed).toBe(true);
    });

    it('does not alert on a single spike', async () => {
      const report = await analyzeRegressionTrend(stableHistory(), run(0, { durationMs: 6000 }), { now: NOW });
      expect(report.assessments[0].unusual).toBe(true);
      expect(report.assessments[0].confirmed).toBe(false);
      expect(report.summary).toBe('No confirmed regression detected');
    });

    it('supports three-run confirmation', async () => {
      const history = [...Array.from({ length: 6 }, (_, index) => run(15 - index)), run(2, { durationMs: 4000 }), run(1, { durationMs: 5000 })];
      const report = await analyzeRegressionTrend(history, run(0, { durationMs: 6000 }), { now: NOW, consecutiveRuns: 3 });
      expect(report.assessments[0].consecutiveRegressions).toBe(3);
      expect(report.assessments[0].confirmed).toBe(true);
    });

    it('breaks a regression streak when the prior run is normal', async () => {
      const history = [...stableHistory(7), run(1)];
      const report = await analyzeRegressionTrend(history, run(0, { durationMs: 6000 }), { now: NOW });
      expect(report.assessments[0].consecutiveRegressions).toBe(1);
    });

    it('formats duration against baseline and seven-day average', async () => {
      const report = await analyzeRegressionTrend(consecutiveHistory(), run(0, { durationMs: 6000 }), { now: NOW });
      expect(report.assessments[0].message).toMatch(/s slower than baseline/);
      expect(report.assessments[0].message).toMatch(/slower than 7d avg/);
    });

    it('identifies a dominant root-cause stage', async () => {
      const current = { ...run(0, { durationMs: 6000 }), stages: [{ stage: 'Database', durationMs: 4800 }] };
      const report = await analyzeRegressionTrend(consecutiveHistory(), current, { now: NOW });
      expect(report.rootCauseHints).toEqual(['Latency spike detected in Database stage (80% of time)']);
    });

    it('does not guess a root cause below the 80 percent threshold', async () => {
      const current = { ...run(0, { durationMs: 6000 }), stages: [{ stage: 'API', durationMs: 4700 }] };
      const report = await analyzeRegressionTrend(consecutiveHistory(), current, { now: NOW });
      expect(report.rootCauseHints).toEqual([]);
    });

    it('detects memory, CPU, network, and error regressions independently', async () => {
      const spike = { errorRate: 0.5, memoryMb: 500, cpuPercent: 90, networkBytes: 9000 };
      const history = [...Array.from({ length: 6 }, (_, index) => run(12 - index)), run(1, spike)];
      const report = await analyzeRegressionTrend(history, run(0, spike), { now: NOW });
      expect(report.assessments.filter(item => item.confirmed).map(item => item.metric)).toEqual([
        'errorRate', 'memoryMb', 'cpuPercent', 'networkBytes'
      ]);
    });
  });

  describe('JIRA escalation boundary', () => {
    it('auto-creates one linked regression issue only after confirmation', async () => {
      const creator = jest.fn<Promise<{ issueKey: string; issueUrl: string }>, [RegressionJiraIssue]>()
        .mockResolvedValue({ issueKey: 'PERF-9', issueUrl: 'https://jira.test/browse/PERF-9' });
      const history = [...Array.from({ length: 6 }, (_, index) => run(12 - index)), run(1, { durationMs: 5000 })];
      const report = await analyzeRegressionTrend(history, run(0, { durationMs: 6000 }), { now: NOW, jiraCreator: creator });
      expect(creator).toHaveBeenCalledTimes(1);
      expect(creator.mock.calls[0][0].summary).toMatch(/^Performance Regression: checkout is .*% slower$/);
      expect(creator.mock.calls[0][0].labels).toContain('performance-regression');
      expect(report.jira?.issueKey).toBe('PERF-9');
    });

    it('does not call JIRA for a one-off spike', async () => {
      const creator = jest.fn().mockResolvedValue({ issueKey: 'SHOULD-NOT-HAPPEN' });
      await analyzeRegressionTrend(stableHistory(), run(0, { durationMs: 6000 }), { now: NOW, jiraCreator: creator });
      expect(creator).not.toHaveBeenCalled();
    });

    it('propagates injected JIRA failures for the caller to handle', async () => {
      const creator = jest.fn().mockRejectedValue(new Error('JIRA unavailable'));
      const history = [...Array.from({ length: 6 }, (_, index) => run(12 - index)), run(1, { durationMs: 5000 })];
      await expect(analyzeRegressionTrend(history, run(0, { durationMs: 6000 }), { now: NOW, jiraCreator: creator }))
        .rejects.toThrow('JIRA unavailable');
    });
  });

  describe('input validation', () => {
    it.each([
      ['durationMs', -1], ['errorRate', -1], ['memoryMb', -1], ['cpuPercent', -1], ['networkBytes', -1]
    ] as const)('rejects invalid %s values', async (metric, value) => {
      await expect(analyzeRegressionTrend(stableHistory(), run(0, { [metric]: value }), { now: NOW }))
        .rejects.toThrow(metric);
    });

    it('rejects error rates above one and CPU above 100', async () => {
      await expect(analyzeRegressionTrend(stableHistory(), run(0, { errorRate: 1.1 }), { now: NOW })).rejects.toThrow('errorRate');
      await expect(analyzeRegressionTrend(stableHistory(), run(0, { cpuPercent: 101 }), { now: NOW })).rejects.toThrow('cpuPercent');
    });

    it('rejects invalid timestamps and blank test identifiers', async () => {
      await expect(analyzeRegressionTrend(stableHistory(), { ...run(0), timestamp: 'bad' }, { now: NOW })).rejects.toThrow('timestamp');
      await expect(analyzeRegressionTrend(stableHistory(), { ...run(0), testId: ' ' }, { now: NOW })).rejects.toThrow('testId');
    });

    it('rejects invalid statistical configuration', async () => {
      await expect(analyzeRegressionTrend(stableHistory(), run(0), { now: NOW, zScoreThreshold: 0 })).rejects.toThrow('zScoreThreshold');
      await expect(analyzeRegressionTrend(stableHistory(), run(0), { now: NOW, consecutiveRuns: 0 })).rejects.toThrow('consecutiveRuns');
    });

    it('rejects invalid stage timings', async () => {
      const current = { ...run(0), stages: [{ stage: '', durationMs: -1 }] };
      await expect(analyzeRegressionTrend(stableHistory(), current, { now: NOW })).rejects.toThrow('Stage name');
    });
  });
});
