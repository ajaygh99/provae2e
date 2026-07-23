import {
  DATADOG_BATCH_SIZE,
  SENTINEL_CUSTOM_METRICS,
  SENTINEL_SYNC_INTERVAL_SECONDS,
  SentinelDatadogApm,
  buildServiceMap,
  buildSentinelDashboard,
  chunkEvents,
  correlateTraces,
  evidenceToLogEvent,
  findingsToMetricSeries,
  ruleToMonitor,
  rulesToMonitors,
  summarizeEvidence,
  toEpochSeconds,
  type DatadogApmClient,
  type DatadogSpan,
  type SentinelFindings,
  type SentinelTrace
} from '../../src/core/sentinel-datadog-apm.js';
import type { SentinelEvidence } from '../../src/core/sentinel-agent.js';

const ISO = '2026-07-23T12:00:00.000Z';
const EPOCH = Math.floor(Date.parse(ISO) / 1000);

/** Builds a fully-typed mock Datadog client whose methods are jest fns. */
function mockClient(overrides: Partial<DatadogApmClient> = {}): jest.Mocked<DatadogApmClient> {
  return {
    submitMetrics: jest.fn(async (series) => ({ accepted: series.length, status: 'ok' as const })),
    submitLogs: jest.fn(async (logs) => ({ accepted: logs.length, status: 'ok' as const })),
    submitTraces: jest.fn(async (spans) => ({ accepted: spans.length, status: 'ok' as const })),
    createMonitor: jest.fn(async () => ({ id: 'mon-1', url: 'https://app.datadoghq.com/monitors/mon-1' })),
    createDashboard: jest.fn(async () => ({ id: 'dash-1', url: 'https://app.datadoghq.com/dashboard/dash-1' })),
    ...overrides
  } as jest.Mocked<DatadogApmClient>;
}

function span(overrides: Partial<DatadogSpan>): DatadogSpan {
  return {
    traceId: 't1',
    spanId: 's1',
    service: 'web',
    name: 'GET /',
    startMs: Date.parse(ISO),
    durationMs: 10,
    error: 0,
    ...overrides
  };
}

function evidence(overrides: Partial<SentinelEvidence> = {}): SentinelEvidence {
  return {
    id: 'sentinel-0001',
    timestamp: ISO,
    level: 'ERROR',
    error: 'boom',
    deploymentSha: 'abc123',
    source: 'datadog',
    testCoveragePercent: 80,
    covered: true,
    actionTaken: 'covered',
    ...overrides
  };
}

describe('constants', () => {
  it('exposes the documented batch size and sync interval', () => {
    expect(DATADOG_BATCH_SIZE).toBe(1000);
    expect(SENTINEL_SYNC_INTERVAL_SECONDS).toBe(60);
    expect(SENTINEL_CUSTOM_METRICS.coverage).toBe('sentinel.coverage');
    expect(SENTINEL_CUSTOM_METRICS.uncoveredIncidents).toBe('sentinel.uncovered_incidents');
    expect(SENTINEL_CUSTOM_METRICS.impact).toBe('sentinel.impact');
  });
});

describe('chunkEvents', () => {
  it('returns an empty array for no events', () => {
    expect(chunkEvents([])).toEqual([]);
  });

  it('keeps a single batch at exactly the batch size', () => {
    const events = Array.from({ length: 1000 }, (_, i) => i);
    const batches = chunkEvents(events);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1000);
  });

  it('splits into a second batch at batch size + 1', () => {
    const events = Array.from({ length: 1001 }, (_, i) => i);
    const batches = chunkEvents(events);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });

  it('honours a custom batch size', () => {
    expect(chunkEvents([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejects a non-positive or fractional batch size', () => {
    expect(() => chunkEvents([1], 0)).toThrow('positive integer');
    expect(() => chunkEvents([1], 1.5)).toThrow('positive integer');
  });
});

describe('toEpochSeconds', () => {
  it('converts a valid ISO timestamp', () => {
    expect(toEpochSeconds(ISO)).toBe(EPOCH);
  });

  it('rejects an invalid timestamp', () => {
    expect(() => toEpochSeconds('not-a-date')).toThrow('invalid timestamp');
  });
});

describe('correlateTraces', () => {
  const sentinelTraces: SentinelTrace[] = [
    { traceId: 't1', sentinelIncidentId: 'sentinel-1', service: 'web', timestamp: ISO },
    { traceId: 't-missing', sentinelIncidentId: 'sentinel-2', service: 'api', timestamp: ISO }
  ];

  it('matches a Sentinel trace id to Datadog spans and reports services + errors', () => {
    const spans = [
      span({ traceId: 't1', spanId: 'a', service: 'web' }),
      span({ traceId: 't1', spanId: 'b', service: 'api', error: 1 })
    ];
    const [matched, missing] = correlateTraces(sentinelTraces, spans);
    expect(matched.matched).toBe(true);
    expect(matched.datadogSpanCount).toBe(2);
    expect(matched.services).toEqual(['api', 'web']);
    expect(matched.hasError).toBe(true);
    expect(missing.matched).toBe(false);
    expect(missing.datadogSpanCount).toBe(0);
    expect(missing.hasError).toBe(false);
  });

  it('rejects a Sentinel trace with a blank trace id', () => {
    expect(() => correlateTraces([{ traceId: '  ', sentinelIncidentId: 'x', service: 'y', timestamp: ISO }], []))
      .toThrow('traceId is required');
  });
});

describe('buildServiceMap', () => {
  it('builds directed edges with call and error propagation counts', () => {
    const spans = [
      span({ spanId: 'root', service: 'web' }),
      span({ spanId: 'child1', parentId: 'root', service: 'api', error: 1 }),
      span({ spanId: 'child2', parentId: 'root', service: 'api', error: 0 }),
      span({ spanId: 'grandchild', parentId: 'child1', service: 'db', error: 0 })
    ];
    const map = buildServiceMap(spans);
    expect(map.services).toEqual(['api', 'db', 'web']);
    const webToApi = map.edges.find((e) => e.from === 'web' && e.to === 'api');
    expect(webToApi).toEqual({ from: 'web', to: 'api', callCount: 2, errorCount: 1 });
    expect(map.edges.find((e) => e.from === 'api' && e.to === 'db')?.callCount).toBe(1);
  });

  it('ignores same-service and dangling parents', () => {
    const spans = [
      span({ spanId: 'a', service: 'web' }),
      span({ spanId: 'b', parentId: 'a', service: 'web' }),
      span({ spanId: 'c', parentId: 'ghost', service: 'api' })
    ];
    const map = buildServiceMap(spans);
    expect(map.edges).toHaveLength(0);
    expect(map.services).toEqual(['api', 'web']);
  });
});

describe('summarizeEvidence', () => {
  it('averages coverage and weights uncovered impact (ERROR counts double)', () => {
    const findings = summarizeEvidence(
      [
        evidence({ testCoveragePercent: 100, covered: true }),
        evidence({ testCoveragePercent: 0, covered: false, level: 'ERROR' }),
        evidence({ testCoveragePercent: 50, covered: false, level: 'WARNING' })
      ],
      'checkout',
      ISO
    );
    expect(findings.coveragePercent).toBe(50);
    expect(findings.uncoveredIncidents).toBe(2);
    expect(findings.impactScore).toBe(30); // ERROR (10*2) + WARNING (10*1)
  });

  it('reports 100% coverage and zero impact for no evidence', () => {
    const findings = summarizeEvidence([], 'checkout', ISO);
    expect(findings.coveragePercent).toBe(100);
    expect(findings.uncoveredIncidents).toBe(0);
    expect(findings.impactScore).toBe(0);
  });

  it('rejects a blank service and non-positive weight', () => {
    expect(() => summarizeEvidence([], '  ', ISO)).toThrow('service is required');
    expect(() => summarizeEvidence([], 'checkout', ISO, 0)).toThrow('impactWeight');
  });
});

describe('findingsToMetricSeries', () => {
  const findings: SentinelFindings = {
    service: 'checkout',
    timestamp: ISO,
    coveragePercent: 82.5,
    uncoveredIncidents: 3,
    impactScore: 40
  };

  it('emits the three custom metrics tagged with the service', () => {
    const series = findingsToMetricSeries(findings);
    expect(series).toHaveLength(3);
    expect(series[0]).toEqual({ metric: 'sentinel.coverage', type: 'gauge', points: [[EPOCH, 82.5]], tags: ['service:checkout'] });
    expect(series[1].metric).toBe('sentinel.uncovered_incidents');
    expect(series[2].points[0][1]).toBe(40);
  });

  it('accepts the 0 and 100 coverage boundaries', () => {
    expect(findingsToMetricSeries({ ...findings, coveragePercent: 0 })[0].points[0][1]).toBe(0);
    expect(findingsToMetricSeries({ ...findings, coveragePercent: 100 })[0].points[0][1]).toBe(100);
  });

  it('rejects out-of-range values', () => {
    expect(() => findingsToMetricSeries({ ...findings, coveragePercent: 101 })).toThrow('coveragePercent');
    expect(() => findingsToMetricSeries({ ...findings, uncoveredIncidents: -1 })).toThrow('uncoveredIncidents');
    expect(() => findingsToMetricSeries({ ...findings, impactScore: -1 })).toThrow('impactScore');
  });
});

describe('evidenceToLogEvent', () => {
  it('maps evidence fields into a Datadog log event', () => {
    const event = evidenceToLogEvent(evidence({ level: 'WARNING' }), 'checkout');
    expect(event.ddsource).toBe('prova-sentinel');
    expect(event.service).toBe('checkout');
    expect(event.status).toBe('warning');
    expect(event.ddtags).toContain('incident_id:sentinel-0001');
    expect(event.timestampMs).toBe(Date.parse(ISO));
  });
});

describe('ruleToMonitor / rulesToMonitors', () => {
  it('builds a metric-alert query and defaults the comparator from metric direction', () => {
    const monitor = ruleToMonitor({ name: 'High p95', metric: 'p95LatencyMs', threshold: 500, service: 'checkout' });
    expect(monitor.type).toBe('metric alert');
    expect(monitor.query).toBe('avg(last_5m):avg:sentinel.p95LatencyMs{service:checkout} > 500');
    expect(monitor.options.thresholds.critical).toBe(500);
    expect(monitor.tags).toContain('source:prova-sentinel');
  });

  it('uses a less-than comparator for a low-is-bad metric (throughput)', () => {
    const monitor = ruleToMonitor({ name: 'Low throughput', metric: 'throughputRps', threshold: 10 });
    expect(monitor.query).toBe('avg(last_5m):avg:sentinel.throughputRps{*} < 10');
  });

  it('honours an explicit comparator, window, and dotted custom metric name', () => {
    const monitor = ruleToMonitor({
      name: 'Coverage gap',
      metric: 'sentinel.coverage',
      threshold: 80,
      comparator: '<=',
      windowMinutes: 15,
      priority: 1,
      message: 'Coverage dropped'
    });
    expect(monitor.query).toBe('avg(last_15m):avg:sentinel.coverage{*} <= 80');
    expect(monitor.priority).toBe(1);
    expect(monitor.message).toBe('Coverage dropped');
  });

  it('maps a batch of rules', () => {
    const monitors = rulesToMonitors([
      { name: 'a', metric: 'errorRate', threshold: 1 },
      { name: 'b', metric: 'cpuPercent', threshold: 90 }
    ]);
    expect(monitors.map((m) => m.name)).toEqual(['a', 'b']);
  });

  it('rejects invalid rules', () => {
    expect(() => ruleToMonitor({ name: '  ', metric: 'errorRate', threshold: 1 })).toThrow('rule name');
    expect(() => ruleToMonitor({ name: 'x', metric: 'errorRate', threshold: Number.NaN })).toThrow('threshold');
    expect(() => ruleToMonitor({ name: 'x', metric: 'errorRate', threshold: 1, windowMinutes: 0 })).toThrow('windowMinutes');
  });
});

describe('buildSentinelDashboard', () => {
  it('builds the pre-built dashboard scoped to all services by default', () => {
    const dashboard = buildSentinelDashboard();
    expect(dashboard.layout_type).toBe('ordered');
    expect(dashboard.widgets.length).toBeGreaterThanOrEqual(5);
    expect(dashboard.widgets[0].definition.requests[0].q).toContain('{*}');
  });

  it('scopes widget queries to a service and honours a title override', () => {
    const dashboard = buildSentinelDashboard({ service: 'checkout', title: 'Checkout Sentinel' });
    expect(dashboard.title).toBe('Checkout Sentinel');
    expect(dashboard.widgets.every((w) => w.definition.requests.every((r) => r.q.includes('service:checkout')))).toBe(true);
  });
});

describe('SentinelDatadogApm', () => {
  const OLD_ENV = process.env['DATADOG_API_KEY'];
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env['DATADOG_API_KEY'];
    else process.env['DATADOG_API_KEY'] = OLD_ENV;
  });

  it('authenticates from the DATADOG_API_KEY env var when no apiKey is passed', () => {
    process.env['DATADOG_API_KEY'] = 'env-key';
    expect(() => new SentinelDatadogApm({ client: mockClient() })).not.toThrow();
  });

  it('throws when no API key is available', () => {
    delete process.env['DATADOG_API_KEY'];
    expect(() => new SentinelDatadogApm({ client: mockClient() })).toThrow('Datadog API key is required');
  });

  it('rejects an invalid batch size', () => {
    expect(() => new SentinelDatadogApm({ client: mockClient(), apiKey: 'k', batchSize: 0 })).toThrow('batchSize');
  });

  it('batches metric ingest and aggregates accepted counts', async () => {
    const client = mockClient();
    const apm = new SentinelDatadogApm({ client, apiKey: 'k', batchSize: 2 });
    const series = Array.from({ length: 5 }, () => findingsToMetricSeries({
      service: 's', timestamp: ISO, coveragePercent: 90, uncoveredIncidents: 0, impactScore: 0
    })[0]);
    const result = await apm.ingestMetrics(series);
    expect(result.status).toBe('ok');
    expect(result.accepted).toBe(5);
    expect(client.submitMetrics).toHaveBeenCalledTimes(3); // 2 + 2 + 1
  });

  it('returns an ok/zero response for empty ingest without calling the client', async () => {
    const client = mockClient();
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    const result = await apm.ingestLogs([]);
    expect(result).toEqual({ accepted: 0, status: 'ok' });
    expect(client.submitLogs).not.toHaveBeenCalled();
  });

  it('filters traces to tracked services before ingesting', async () => {
    const client = mockClient();
    const apm = new SentinelDatadogApm({ client, apiKey: 'k', trackedServices: ['web'] });
    const spans = [span({ service: 'web' }), span({ service: 'other', spanId: 's2' })];
    const result = await apm.ingestTraces(spans);
    expect(result.accepted).toBe(1);
    expect(client.submitTraces).toHaveBeenCalledWith([expect.objectContaining({ service: 'web' })]);
  });

  it('reports an error response when the client rejects a batch', async () => {
    const client = mockClient({ submitMetrics: jest.fn(async () => ({ accepted: 0, status: 'error' as const, detail: 'rate limited' })) });
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    const result = await apm.ingestMetrics(findingsToMetricSeries({
      service: 's', timestamp: ISO, coveragePercent: 90, uncoveredIncidents: 0, impactScore: 0
    }));
    expect(result.status).toBe('error');
    expect(result.detail).toBe('rate limited');
  });

  it('captures a thrown transport error without throwing', async () => {
    const client = mockClient({ submitLogs: jest.fn(async () => { throw new Error('network down'); }) });
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    const result = await apm.ingestLogs([evidenceToLogEvent(evidence(), 's')]);
    expect(result).toEqual({ accepted: 0, status: 'error', detail: 'network down' });
  });

  it('ingests findings as custom metrics', async () => {
    const client = mockClient();
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    const result = await apm.ingestFindings({ service: 's', timestamp: ISO, coveragePercent: 75, uncoveredIncidents: 2, impactScore: 20 });
    expect(result.accepted).toBe(3);
    expect(client.submitMetrics).toHaveBeenCalledTimes(1);
  });

  it('creates monitors from rules', async () => {
    const client = mockClient();
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    const created = await apm.createMonitorsFromRules([{ name: 'x', metric: 'errorRate', threshold: 1 }]);
    expect(created).toEqual([{ id: 'mon-1', url: 'https://app.datadoghq.com/monitors/mon-1' }]);
    expect(client.createMonitor).toHaveBeenCalledTimes(1);
  });

  it('wraps a monitor-creation failure with context', async () => {
    const client = mockClient({ createMonitor: jest.fn(async () => { throw new Error('403'); }) });
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    await expect(apm.createMonitorsFromRules([{ name: 'boom', metric: 'errorRate', threshold: 1 }]))
      .rejects.toThrow('Failed to create Datadog monitor "boom": 403');
  });

  it('creates the pre-built dashboard', async () => {
    const client = mockClient();
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    const result = await apm.createDashboard({ service: 'checkout' });
    expect(result.id).toBe('dash-1');
    expect(client.createDashboard).toHaveBeenCalledWith(expect.objectContaining({ layout_type: 'ordered' }));
  });

  it('wraps a dashboard-creation failure with context', async () => {
    const client = mockClient({ createDashboard: jest.fn(async () => { throw new Error('bad request'); }) });
    const apm = new SentinelDatadogApm({ client, apiKey: 'k' });
    await expect(apm.createDashboard()).rejects.toThrow('Failed to create Sentinel dashboard: bad request');
  });
});
