import {
  aggregateSentinelDashboard,
  ageLabel,
  buildActiveAlerts,
  buildLiveStatus,
  buildRecommendations,
  buildTestGaps,
  buildTrendSeries,
  classifyHealth,
  gapRecommendation,
  incidentImpactLabel,
  sortIncidents,
  toDashboardIncident,
  TREND_RANGES,
  type AlertInput,
  type DashboardIncidentInput,
  type SentinelDashboardInput,
  type TestGapInput
} from '../../src/core/sentinel-dashboard-aggregator.js';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const clock = (): Date => NOW;

function baseInput(overrides: Partial<SentinelDashboardInput> = {}): SentinelDashboardInput {
  return {
    service: 'checkout-api',
    status: { trafficRpm: 1200, errorRatePercent: 0.3, latencyMsP95: 210, uptimePercent: 99.98 },
    incidents: [],
    gaps: [],
    alerts: [],
    trends: {},
    ...overrides
  };
}

describe('classifyHealth', () => {
  it('returns healthy within all bounds', () => {
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 0.2, latencyMsP95: 100, uptimePercent: 100 })).toBe('healthy');
  });

  it('returns degraded when a degraded bound is crossed', () => {
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 2, latencyMsP95: 100, uptimePercent: 100 })).toBe('degraded');
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 0, latencyMsP95: 600, uptimePercent: 100 })).toBe('degraded');
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 0, latencyMsP95: 100, uptimePercent: 99.5 })).toBe('degraded');
  });

  it('returns critical when a critical bound is crossed', () => {
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 6, latencyMsP95: 100, uptimePercent: 100 })).toBe('critical');
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 0, latencyMsP95: 1200, uptimePercent: 100 })).toBe('critical');
    expect(classifyHealth({ trafficRpm: 10, errorRatePercent: 0, latencyMsP95: 100, uptimePercent: 98 })).toBe('critical');
  });
});

describe('buildLiveStatus', () => {
  it('rounds values and derives health', () => {
    const status = buildLiveStatus({ trafficRpm: 1200.4, errorRatePercent: 0.256, latencyMsP95: 210.9, uptimePercent: 99.98123 });
    expect(status).toEqual({
      trafficRpm: 1200.4,
      errorRatePercent: 0.26,
      latencyMsP95: 210.9,
      uptimePercent: 99.9812,
      health: 'healthy'
    });
  });

  it('rejects out-of-range error rate', () => {
    expect(() => buildLiveStatus({ trafficRpm: 1, errorRatePercent: 150, latencyMsP95: 1, uptimePercent: 100 })).toThrow(/errorRatePercent/);
  });

  it('rejects negative traffic', () => {
    expect(() => buildLiveStatus({ trafficRpm: -1, errorRatePercent: 1, latencyMsP95: 1, uptimePercent: 100 })).toThrow(/trafficRpm/);
  });
});

describe('toDashboardIncident', () => {
  const incident: DashboardIncidentInput = {
    id: 'INC-1',
    title: 'Checkout 500s',
    startedAt: '2026-07-23T11:30:00.000Z',
    endedAt: '2026-07-23T11:45:00.000Z',
    severity: 'critical',
    usersAffected: 320,
    revenueAtRisk: 1450.5
  };

  it('computes a resolved incident duration', () => {
    const result = toDashboardIncident(incident, NOW_MS);
    expect(result.ongoing).toBe(false);
    expect(result.durationMinutes).toBe(15);
    expect(result.impactLabel).toContain('320');
    expect(result.endedAt).toBe('2026-07-23T11:45:00.000Z');
  });

  it('treats a missing endedAt as ongoing and sizes duration to now', () => {
    const { endedAt, ...ongoing } = incident;
    void endedAt;
    const result = toDashboardIncident(ongoing, NOW_MS);
    expect(result.ongoing).toBe(true);
    expect(result.durationMinutes).toBe(30);
    expect(result.endedAt).toBeUndefined();
  });

  it('rejects an end before start', () => {
    expect(() => toDashboardIncident({ ...incident, endedAt: '2026-07-23T11:00:00.000Z' }, NOW_MS)).toThrow(/must not precede/);
  });

  it('rejects a blank id', () => {
    expect(() => toDashboardIncident({ ...incident, id: ' ' }, NOW_MS)).toThrow(/incident id/);
  });

  it('rejects a fractional usersAffected', () => {
    expect(() => toDashboardIncident({ ...incident, usersAffected: 1.5 }, NOW_MS)).toThrow(/usersAffected/);
  });
});

describe('sortIncidents', () => {
  it('orders by severity then most recent start', () => {
    const incidents = [
      toDashboardIncident({ id: 'a', title: 'a', startedAt: '2026-07-23T10:00:00Z', severity: 'low', usersAffected: 1, revenueAtRisk: 1 }, NOW_MS),
      toDashboardIncident({ id: 'b', title: 'b', startedAt: '2026-07-23T09:00:00Z', severity: 'critical', usersAffected: 1, revenueAtRisk: 1 }, NOW_MS),
      toDashboardIncident({ id: 'c', title: 'c', startedAt: '2026-07-23T11:00:00Z', severity: 'critical', usersAffected: 1, revenueAtRisk: 1 }, NOW_MS)
    ];
    expect(sortIncidents(incidents).map(i => i.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('buildTestGaps', () => {
  const gaps: TestGapInput[] = [
    { pattern: 'NullRef', occurrences: 3, coveragePercent: 40 },
    { pattern: 'Timeout', occurrences: 9, coveragePercent: 0 },
    { pattern: 'Retry', occurrences: 9, coveragePercent: 55 }
  ];

  it('sorts by frequency then ascending coverage', () => {
    const result = buildTestGaps(gaps);
    expect(result.map(g => g.pattern)).toEqual(['Timeout', 'Retry', 'NullRef']);
    expect(result[0].recommendation).toMatch(/No coverage/);
  });

  it('rejects a negative coverage', () => {
    expect(() => buildTestGaps([{ pattern: 'x', occurrences: 1, coveragePercent: -5 }])).toThrow(/coveragePercent/);
  });
});

describe('buildActiveAlerts', () => {
  const alerts: AlertInput[] = [
    { id: 'A1', title: 'High latency', severity: 'warning', raisedAt: '2026-07-23T11:30:00.000Z' },
    { id: 'A2', title: 'Down', severity: 'critical', raisedAt: '2026-07-23T09:00:00.000Z' },
    { id: 'A3', title: 'Resolved one', severity: 'info', raisedAt: '2026-07-23T08:00:00.000Z', resolvedAt: '2026-07-23T08:30:00.000Z' }
  ];

  it('auto-dismisses resolved alerts and sorts by severity then age', () => {
    const result = buildActiveAlerts(alerts, NOW_MS);
    expect(result.map(a => a.id)).toEqual(['A2', 'A1']);
    expect(result[0].ageMinutes).toBe(180);
    expect(result[0].ageLabel).toBe('3h');
  });

  it('validates a resolved alert timestamp before dismissing', () => {
    expect(() => buildActiveAlerts([{ id: 'x', title: 't', severity: 'info', raisedAt: '2026-07-23T08:00:00Z', resolvedAt: 'not-a-date' }], NOW_MS)).toThrow(/resolvedAt/);
  });

  it('rejects a blank alert title', () => {
    expect(() => buildActiveAlerts([{ id: 'x', title: '', severity: 'info', raisedAt: '2026-07-23T08:00:00Z' }], NOW_MS)).toThrow(/alert title/);
  });
});

describe('buildTrendSeries', () => {
  it('sorts points chronologically and computes maxima', () => {
    const series = buildTrendSeries('24h', [
      { timestamp: '2026-07-23T11:00:00Z', latencyMs: 300, errorRatePercent: 2 },
      { timestamp: '2026-07-23T10:00:00Z', latencyMs: 150, errorRatePercent: 1 }
    ]);
    expect(series.points.map(p => p.latencyMs)).toEqual([150, 300]);
    expect(series.maxLatencyMs).toBe(300);
    expect(series.maxErrorRatePercent).toBe(2);
  });

  it('handles an empty window', () => {
    const series = buildTrendSeries('7d', []);
    expect(series.points).toHaveLength(0);
    expect(series.maxLatencyMs).toBe(0);
  });

  it('rejects an invalid latency', () => {
    expect(() => buildTrendSeries('30d', [{ timestamp: '2026-07-23T10:00:00Z', latencyMs: -1, errorRatePercent: 1 }])).toThrow(/latencyMs/);
  });
});

describe('buildRecommendations', () => {
  it('derives and prioritizes recommendations from gaps and incidents', () => {
    const gaps = buildTestGaps([
      { pattern: 'Timeout', occurrences: 5, coveragePercent: 0 },
      { pattern: 'Retry', occurrences: 2, coveragePercent: 60 },
      { pattern: 'Covered', occurrences: 1, coveragePercent: 95 }
    ]);
    const incidents = [
      toDashboardIncident({ id: 'INC-1', title: 'Outage', startedAt: '2026-07-23T11:00:00Z', severity: 'critical', usersAffected: 10, revenueAtRisk: 100 }, NOW_MS),
      toDashboardIncident({ id: 'INC-2', title: 'Minor', startedAt: '2026-07-23T11:00:00Z', severity: 'low', usersAffected: 1, revenueAtRisk: 1 }, NOW_MS)
    ];
    const recs = buildRecommendations(gaps, incidents);
    expect(recs[0].priority).toBe('high');
    expect(recs.some(r => r.title.includes('Timeout'))).toBe(true);
    expect(recs.some(r => r.title.includes('INC-1'))).toBe(true);
    expect(recs.some(r => r.title.includes('Covered'))).toBe(false);
    expect(recs.some(r => r.title.includes('INC-2'))).toBe(false);
  });

  it('caps at ten recommendations', () => {
    const gaps = buildTestGaps(
      Array.from({ length: 15 }, (_, index) => ({ pattern: `p${index}`, occurrences: 1, coveragePercent: 0 }))
    );
    expect(buildRecommendations(gaps, [])).toHaveLength(10);
  });
});

describe('helpers', () => {
  it('formats incident impact', () => {
    expect(incidentImpactLabel(1200, 5000)).toBe('1,200 user(s) affected · $5,000 at risk');
  });

  it('formats gap recommendations by band', () => {
    expect(gapRecommendation(0)).toMatch(/No coverage/);
    expect(gapRecommendation(50)).toMatch(/Below target/);
    expect(gapRecommendation(90)).toMatch(/meets target/);
  });

  it('formats age labels across units', () => {
    expect(ageLabel(0.5)).toBe('just now');
    expect(ageLabel(30)).toBe('30m');
    expect(ageLabel(120)).toBe('2h');
    expect(ageLabel(2880)).toBe('2d');
    expect(() => ageLabel(-1)).toThrow(/ageMinutes/);
  });
});

describe('aggregateSentinelDashboard', () => {
  it('assembles a complete model with all three trend windows', () => {
    const input = baseInput({
      incidents: [
        { id: 'INC-1', title: 'Outage', startedAt: '2026-07-23T11:00:00Z', severity: 'critical', usersAffected: 50, revenueAtRisk: 900 }
      ],
      gaps: [{ pattern: 'Timeout', occurrences: 4, coveragePercent: 0 }],
      alerts: [{ id: 'A1', title: 'Down', severity: 'critical', raisedAt: '2026-07-23T11:00:00Z' }],
      trends: { '24h': [{ timestamp: '2026-07-23T11:00:00Z', latencyMs: 200, errorRatePercent: 1 }] }
    });
    const model = aggregateSentinelDashboard(input, { now: clock });
    expect(model.service).toBe('checkout-api');
    expect(model.generatedAt).toBe(NOW.toISOString());
    expect(model.status.health).toBe('healthy');
    expect(model.incidents).toHaveLength(1);
    expect(model.gaps[0].pattern).toBe('Timeout');
    expect(model.alerts).toHaveLength(1);
    expect(TREND_RANGES.every(range => range in model.trends)).toBe(true);
    expect(model.trends['7d'].points).toHaveLength(0);
    expect(model.recommendations.length).toBeGreaterThan(0);
  });

  it('rejects a blank service', () => {
    expect(() => aggregateSentinelDashboard(baseInput({ service: '' }), { now: clock })).toThrow(/service/);
  });

  it('defaults the clock when none is supplied', () => {
    const model = aggregateSentinelDashboard(baseInput());
    expect(Number.isFinite(Date.parse(model.generatedAt))).toBe(true);
  });
});
