import {
  buildAttackRequest,
  compareExpectedVsActual,
  computeErrorRateComparison,
  computeTimeToRecovery,
  isWithinLowTrafficWindow,
  meanTimeToRecovery,
  nextLowTrafficWindow,
  parseChaosExperiments,
  recommendTestGaps,
  resolveChaosApiKey,
  runChaosExperiment,
  scoreChaosResult,
  validateChaosExperiment,
  validateRecoverySlo,
  type ChaosClient,
  type ChaosExperiment,
  type ChaosExperimentResult,
  type ChaosMonitor,
  type ChaosObservation,
  type ChaosValidationCheck,
  type RecoverySample
} from '../../src/core/sentinel-chaos.js';

const INJECTED_AT = '2026-07-23T02:00:00.000Z';

/** Builds a valid experiment with sensible defaults. */
function experiment(overrides: Partial<ChaosExperiment> = {}): ChaosExperiment {
  return {
    id: 'exp-latency',
    provider: 'gremlin',
    failureType: 'latency-spike',
    target: 'checkout-service',
    durationSeconds: 60,
    intensity: 0.5,
    recoverySloSeconds: 120,
    validationChecks: [
      { id: 'availability', description: 'checkout stays available', metric: 'availability', expectedToHold: true },
      { id: 'latency', description: 'latency degrades under load', metric: 'p95LatencyMs', expectedToHold: false }
    ],
    ...overrides
  };
}

/** Builds recovery samples at fixed second offsets from INJECTED_AT. */
function samples(points: Array<[offsetSeconds: number, healthy: boolean]>): RecoverySample[] {
  const base = Date.parse(INJECTED_AT);
  return points.map(([offset, healthy]) => ({
    timestamp: new Date(base + offset * 1000).toISOString(),
    healthy
  }));
}

/** Builds a stub chaos client with jest-tracked inject/halt. */
function stubClient(provider: ChaosClient['provider'] = 'gremlin'): ChaosClient {
  return {
    provider,
    inject: jest.fn(async () => ({ attackId: 'atk-1' })),
    halt: jest.fn(async () => undefined)
  };
}

/** Builds a monitor returning a fixed observation. */
function stubMonitor(observation: ChaosObservation): ChaosMonitor {
  return jest.fn(async () => observation);
}

const CLEAN_OBSERVATION: ChaosObservation = {
  recoverySamples: [
    { timestamp: '2026-07-23T02:00:30.000Z', healthy: false },
    { timestamp: '2026-07-23T02:01:00.000Z', healthy: true }
  ],
  checkObservations: [
    { id: 'availability', held: true },
    { id: 'latency', held: false }
  ],
  normalErrorRate: 0.01,
  chaosErrorRate: 0.015
};

describe('resolveChaosApiKey', () => {
  it('prefers an explicit key over the environment', () => {
    expect(resolveChaosApiKey({ apiKey: 'explicit-key', env: { GREMLIN_API_KEY: 'env-key' } })).toBe('explicit-key');
  });

  it('falls back to GREMLIN_API_KEY from the environment', () => {
    expect(resolveChaosApiKey({ env: { GREMLIN_API_KEY: 'env-key' } })).toBe('env-key');
  });

  it('throws when neither source provides a key', () => {
    expect(() => resolveChaosApiKey({ env: {} })).toThrow('GREMLIN_API_KEY');
    expect(() => resolveChaosApiKey({ apiKey: '   ', env: {} })).toThrow('required');
  });
});

describe('validateChaosExperiment', () => {
  it('accepts a well-formed experiment', () => {
    expect(() => validateChaosExperiment(experiment())).not.toThrow();
  });

  it('accepts the intensity boundaries 0 and 1', () => {
    expect(() => validateChaosExperiment(experiment({ intensity: 0 }))).not.toThrow();
    expect(() => validateChaosExperiment(experiment({ intensity: 1 }))).not.toThrow();
  });

  it('rejects out-of-range intensity', () => {
    expect(() => validateChaosExperiment(experiment({ intensity: -0.01 }))).toThrow('intensity');
    expect(() => validateChaosExperiment(experiment({ intensity: 1.01 }))).toThrow('intensity');
  });

  it('rejects invalid provider and failure type', () => {
    expect(() => validateChaosExperiment(experiment({ provider: 'nope' as ChaosExperiment['provider'] }))).toThrow('provider');
    expect(() => validateChaosExperiment(experiment({ failureType: 'meltdown' as ChaosExperiment['failureType'] }))).toThrow('failure type');
  });

  it('rejects non-positive duration and SLO', () => {
    expect(() => validateChaosExperiment(experiment({ durationSeconds: 0 }))).toThrow('durationSeconds');
    expect(() => validateChaosExperiment(experiment({ recoverySloSeconds: 0 }))).toThrow('recoverySloSeconds');
  });

  it('rejects missing ids, empty checks, and duplicate check ids', () => {
    expect(() => validateChaosExperiment(experiment({ id: ' ' }))).toThrow('experiment.id');
    expect(() => validateChaosExperiment(experiment({ validationChecks: [] }))).toThrow('at least one check');
    const dup: ChaosValidationCheck[] = [
      { id: 'x', description: 'a', metric: 'm', expectedToHold: true },
      { id: 'x', description: 'b', metric: 'm', expectedToHold: false }
    ];
    expect(() => validateChaosExperiment(experiment({ validationChecks: dup }))).toThrow('Duplicate');
  });
});

describe('parseChaosExperiments', () => {
  const yaml = `
experiments:
  - id: exp-1
    provider: gremlin
    failureType: network-partition
    target: payments
    durationSeconds: 30
    intensity: 0.8
    recoverySloSeconds: 90
    validationChecks:
      - id: payments-up
        description: payments stays up
        metric: availability
        expectedToHold: true
`;

  it('parses an experiments[] document', () => {
    const parsed = parseChaosExperiments(yaml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].failureType).toBe('network-partition');
    expect(parsed[0].validationChecks[0].expectedToHold).toBe(true);
  });

  it('parses a single-experiment document', () => {
    const single = `
id: solo
provider: chaos-monkey
failureType: instance-failure
target: api
durationSeconds: 45
intensity: 0.3
recoverySloSeconds: 60
validationChecks:
  - id: api-up
    description: api up
    metric: availability
    expectedToHold: true
`;
    const parsed = parseChaosExperiments(single);
    expect(parsed[0].provider).toBe('chaos-monkey');
  });

  it('rejects invalid YAML and empty documents', () => {
    expect(() => parseChaosExperiments(':\n  - [')).toThrow('Invalid chaos experiment YAML');
    expect(() => parseChaosExperiments('experiments: []')).toThrow('no experiments');
  });

  it('propagates validation errors for malformed experiments', () => {
    const bad = `
experiments:
  - id: bad
    provider: gremlin
    failureType: latency-spike
    target: svc
    durationSeconds: 10
    intensity: 5
    recoverySloSeconds: 60
    validationChecks:
      - id: c
        description: d
        metric: m
        expectedToHold: true
`;
    expect(() => parseChaosExperiments(bad)).toThrow('intensity');
  });
});

describe('buildAttackRequest', () => {
  it('maps experiment fields into an attack request', () => {
    const request = buildAttackRequest(experiment());
    expect(request).toEqual({
      provider: 'gremlin',
      failureType: 'latency-spike',
      target: 'checkout-service',
      durationSeconds: 60,
      intensity: 0.5
    });
  });

  it('validates before building', () => {
    expect(() => buildAttackRequest(experiment({ target: '' }))).toThrow('target');
  });
});

describe('computeTimeToRecovery', () => {
  it('measures time to sustained recovery', () => {
    const result = computeTimeToRecovery(INJECTED_AT, samples([[30, false], [60, true], [90, true]]));
    expect(result.recovered).toBe(true);
    expect(result.timeToRecoverySeconds).toBe(60);
    expect(result.firstHealthyAt).toBe('2026-07-23T02:01:00.000Z');
  });

  it('ignores a transient healthy blip that regresses', () => {
    const result = computeTimeToRecovery(INJECTED_AT, samples([[30, true], [60, false], [90, true]]));
    expect(result.timeToRecoverySeconds).toBe(90);
  });

  it('reports zero recovery time when healthy from the first sample', () => {
    const result = computeTimeToRecovery(INJECTED_AT, samples([[0, true], [30, true]]));
    expect(result.timeToRecoverySeconds).toBe(0);
  });

  it('reports never-recovered when it stays unhealthy', () => {
    const result = computeTimeToRecovery(INJECTED_AT, samples([[30, false], [60, false]]));
    expect(result.recovered).toBe(false);
    expect(result.timeToRecoverySeconds).toBeNull();
    expect(result.firstHealthyAt).toBeNull();
  });

  it('sorts out-of-order samples', () => {
    const result = computeTimeToRecovery(INJECTED_AT, samples([[90, true], [30, false], [60, true]]));
    expect(result.timeToRecoverySeconds).toBe(60);
  });

  it('rejects invalid input', () => {
    expect(() => computeTimeToRecovery('bad', samples([[30, true]]))).toThrow('injectedAt');
    expect(() => computeTimeToRecovery(INJECTED_AT, [])).toThrow('at least one');
    expect(() => computeTimeToRecovery(INJECTED_AT, [{ timestamp: 'bad', healthy: true }])).toThrow('sample timestamp');
    expect(() => computeTimeToRecovery(INJECTED_AT, samples([[-30, true]]))).toThrow('precede');
  });
});

describe('validateRecoverySlo', () => {
  it('passes when recovery is strictly within SLO', () => {
    const slo = validateRecoverySlo({ recovered: true, timeToRecoverySeconds: 60, firstHealthyAt: 'x' }, 120);
    expect(slo.withinSlo).toBe(true);
  });

  it('passes at exactly the SLO boundary (inclusive)', () => {
    const slo = validateRecoverySlo({ recovered: true, timeToRecoverySeconds: 120, firstHealthyAt: 'x' }, 120);
    expect(slo.withinSlo).toBe(true);
  });

  it('fails one second over the SLO', () => {
    const slo = validateRecoverySlo({ recovered: true, timeToRecoverySeconds: 121, firstHealthyAt: 'x' }, 120);
    expect(slo.withinSlo).toBe(false);
  });

  it('fails when never recovered', () => {
    const slo = validateRecoverySlo({ recovered: false, timeToRecoverySeconds: null, firstHealthyAt: null }, 120);
    expect(slo.withinSlo).toBe(false);
  });

  it('rejects a non-positive SLO', () => {
    expect(() => validateRecoverySlo({ recovered: true, timeToRecoverySeconds: 1, firstHealthyAt: 'x' }, 0)).toThrow('recoverySloSeconds');
  });
});

describe('compareExpectedVsActual', () => {
  const checks: ChaosValidationCheck[] = [
    { id: 'a', description: 'a holds', metric: 'availability', expectedToHold: true },
    { id: 'b', description: 'b breaks by design', metric: 'latency', expectedToHold: false }
  ];

  it('flags an unexpected break when an invariant expected to hold breaks', () => {
    const result = compareExpectedVsActual(checks, [{ id: 'a', held: false }, { id: 'b', held: false }]);
    expect(result.unexpectedBreaks).toEqual(['a']);
    expect(result.expectedBreaks).toEqual(['b']);
    expect(result.cleanResilience).toBe(false);
    expect(result.checks[0].outcome).toBe('unexpected-break');
  });

  it('reports clean resilience when everything holds as expected', () => {
    const result = compareExpectedVsActual(checks, [{ id: 'a', held: true }, { id: 'b', held: false }]);
    expect(result.cleanResilience).toBe(true);
    expect(result.checks[0].outcome).toBe('held-as-expected');
    expect(result.checks[1].outcome).toBe('expected-break');
  });

  it('classifies unexpected resilience when a check survived that was expected to break', () => {
    const result = compareExpectedVsActual(checks, [{ id: 'a', held: true }, { id: 'b', held: true }]);
    expect(result.checks[1].outcome).toBe('unexpected-resilience');
    expect(result.cleanResilience).toBe(true);
  });

  it('rejects empty checks and missing observations', () => {
    expect(() => compareExpectedVsActual([], [])).toThrow('at least one check');
    expect(() => compareExpectedVsActual(checks, [{ id: 'a', held: true }])).toThrow('missing observation');
  });
});

describe('computeErrorRateComparison', () => {
  it('computes delta and ratio for a normal increase', () => {
    const result = computeErrorRateComparison(0.02, 0.1);
    expect(result.delta).toBeCloseTo(0.08, 10);
    expect(result.ratio).toBeCloseTo(5, 10);
  });

  it('returns ratio 1 when both rates are zero', () => {
    expect(computeErrorRateComparison(0, 0).ratio).toBe(1);
  });

  it('returns Infinity when normal is zero but chaos is positive', () => {
    expect(computeErrorRateComparison(0, 0.05).ratio).toBe(Number.POSITIVE_INFINITY);
  });

  it('accepts the 0 and 1 rate boundaries', () => {
    expect(() => computeErrorRateComparison(0, 1)).not.toThrow();
  });

  it('rejects out-of-range rates', () => {
    expect(() => computeErrorRateComparison(-0.01, 0.1)).toThrow('normalErrorRate');
    expect(() => computeErrorRateComparison(0.1, 1.01)).toThrow('chaosErrorRate');
  });
});

describe('low-traffic scheduling windows', () => {
  it('detects a timestamp inside a daytime window (half-open)', () => {
    expect(isWithinLowTrafficWindow('2026-07-23T02:30:00.000Z', [{ startHourUtc: 2, endHourUtc: 5 }])).toBe(true);
    expect(isWithinLowTrafficWindow('2026-07-23T05:00:00.000Z', [{ startHourUtc: 2, endHourUtc: 5 }])).toBe(false);
    expect(isWithinLowTrafficWindow('2026-07-23T02:00:00.000Z', [{ startHourUtc: 2, endHourUtc: 5 }])).toBe(true);
  });

  it('detects a timestamp inside an overnight window spanning midnight', () => {
    const window = [{ startHourUtc: 22, endHourUtc: 4 }];
    expect(isWithinLowTrafficWindow('2026-07-23T23:00:00.000Z', window)).toBe(true);
    expect(isWithinLowTrafficWindow('2026-07-23T03:00:00.000Z', window)).toBe(true);
    expect(isWithinLowTrafficWindow('2026-07-23T12:00:00.000Z', window)).toBe(false);
  });

  it('rejects invalid windows and timestamps', () => {
    expect(() => isWithinLowTrafficWindow('bad', [{ startHourUtc: 1, endHourUtc: 2 }])).toThrow('timestamp');
    expect(() => isWithinLowTrafficWindow(INJECTED_AT, [{ startHourUtc: 24, endHourUtc: 2 }])).toThrow('startHourUtc');
    expect(() => isWithinLowTrafficWindow(INJECTED_AT, [{ startHourUtc: 1, endHourUtc: 25 }])).toThrow('endHourUtc');
  });

  it('returns the input when already inside a window', () => {
    expect(nextLowTrafficWindow('2026-07-23T02:30:00.000Z', [{ startHourUtc: 2, endHourUtc: 5 }])).toBe('2026-07-23T02:30:00.000Z');
  });

  it('advances to the next window opening', () => {
    const next = nextLowTrafficWindow('2026-07-23T12:00:00.000Z', [{ startHourUtc: 2, endHourUtc: 5 }]);
    expect(next).toBe('2026-07-24T02:00:00.000Z');
  });

  it('rejects an empty window list', () => {
    expect(() => nextLowTrafficWindow(INJECTED_AT, [])).toThrow('at least one window');
  });
});

describe('recommendTestGaps', () => {
  it('recommends recovery coverage when the system never recovered', () => {
    const recovery = { recovered: false, timeToRecoverySeconds: null, firstHealthyAt: null };
    const slo = validateRecoverySlo(recovery, 120);
    const comparison = compareExpectedVsActual(experiment().validationChecks, [{ id: 'availability', held: true }, { id: 'latency', held: false }]);
    const errorRate = computeErrorRateComparison(0.01, 0.01);
    const recs = recommendTestGaps(experiment(), recovery, slo, comparison, errorRate);
    expect(recs.some((r) => r.category === 'recovery' && r.severity === 'high')).toBe(true);
  });

  it('recommends an SLO regression test when recovery breached the SLO', () => {
    const recovery = { recovered: true, timeToRecoverySeconds: 200, firstHealthyAt: 'x' };
    const slo = validateRecoverySlo(recovery, 120);
    const comparison = compareExpectedVsActual(experiment().validationChecks, [{ id: 'availability', held: true }, { id: 'latency', held: false }]);
    const recs = recommendTestGaps(experiment(), recovery, slo, comparison, computeErrorRateComparison(0.01, 0.01));
    expect(recs.some((r) => r.category === 'recovery' && r.message.includes('SLO'))).toBe(true);
  });

  it('recommends guarding tests for unexpected breaks and error-rate blow-ups', () => {
    const recovery = { recovered: true, timeToRecoverySeconds: 30, firstHealthyAt: 'x' };
    const slo = validateRecoverySlo(recovery, 120);
    const comparison = compareExpectedVsActual(experiment().validationChecks, [{ id: 'availability', held: false }, { id: 'latency', held: false }]);
    const errorRate = computeErrorRateComparison(0.02, 0.2);
    const recs = recommendTestGaps(experiment(), recovery, slo, comparison, errorRate);
    expect(recs.some((r) => r.category === 'unexpected-break')).toBe(true);
    expect(recs.some((r) => r.category === 'error-rate' && r.severity === 'high')).toBe(true);
  });

  it('produces no recommendations for a clean pass', () => {
    const recovery = { recovered: true, timeToRecoverySeconds: 30, firstHealthyAt: 'x' };
    const slo = validateRecoverySlo(recovery, 120);
    const comparison = compareExpectedVsActual(experiment().validationChecks, [{ id: 'availability', held: true }, { id: 'latency', held: false }]);
    const recs = recommendTestGaps(experiment(), recovery, slo, comparison, computeErrorRateComparison(0.01, 0.01));
    expect(recs).toHaveLength(0);
  });
});

describe('scoreChaosResult', () => {
  const cleanRecovery = { recovered: true, timeToRecoverySeconds: 30, firstHealthyAt: 'x' };
  const cleanComparison = compareExpectedVsActual(experiment().validationChecks, [{ id: 'availability', held: true }, { id: 'latency', held: false }]);

  it('gives full credit for a clean chaos pass', () => {
    const slo = validateRecoverySlo(cleanRecovery, 120);
    expect(scoreChaosResult(cleanRecovery, slo, cleanComparison, computeErrorRateComparison(0.01, 0.01))).toBe(100);
  });

  it('deducts heavily when the system never recovered', () => {
    const recovery = { recovered: false, timeToRecoverySeconds: null, firstHealthyAt: null };
    const slo = validateRecoverySlo(recovery, 120);
    expect(scoreChaosResult(recovery, slo, cleanComparison, computeErrorRateComparison(0.01, 0.01))).toBe(50);
  });

  it('never drops below zero', () => {
    const recovery = { recovered: false, timeToRecoverySeconds: null, firstHealthyAt: null };
    const slo = validateRecoverySlo(recovery, 120);
    const broken = compareExpectedVsActual(
      [
        { id: 'a', description: 'a', metric: 'm', expectedToHold: true },
        { id: 'b', description: 'b', metric: 'm', expectedToHold: true }
      ],
      [{ id: 'a', held: false }, { id: 'b', held: false }]
    );
    expect(scoreChaosResult(recovery, slo, broken, computeErrorRateComparison(0, 0.5))).toBe(0);
  });
});

describe('meanTimeToRecovery', () => {
  function result(seconds: number | null): ChaosExperimentResult {
    return {
      experimentId: 'e', provider: 'gremlin', failureType: 'latency-spike', target: 't',
      injectedAt: INJECTED_AT, haltedAt: INJECTED_AT,
      recovery: { recovered: seconds !== null, timeToRecoverySeconds: seconds, firstHealthyAt: null },
      slo: { recoverySloSeconds: 120, timeToRecoverySeconds: seconds, withinSlo: true },
      comparison: { checks: [], unexpectedBreaks: [], expectedBreaks: [], cleanResilience: true },
      errorRate: { normalErrorRate: 0, chaosErrorRate: 0, delta: 0, ratio: 1 },
      gapRecommendations: [], passed: true, score: 100, summary: ''
    };
  }

  it('averages only the recovered results', () => {
    expect(meanTimeToRecovery([result(30), result(90), result(null)])).toBe(60);
  });

  it('returns null when nothing recovered', () => {
    expect(meanTimeToRecovery([result(null), result(null)])).toBeNull();
  });
});

describe('runChaosExperiment', () => {
  it('runs end to end and passes on clean resilience within SLO', async () => {
    const client = stubClient();
    const monitor = stubMonitor(CLEAN_OBSERVATION);
    const result = await runChaosExperiment(experiment(), { client, monitor }, { now: () => new Date(INJECTED_AT) });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.recovery.timeToRecoverySeconds).toBe(60);
    expect(result.slo.withinSlo).toBe(true);
    expect(result.gapRecommendations).toHaveLength(0);
    expect(client.inject).toHaveBeenCalledTimes(1);
    expect(client.halt).toHaveBeenCalledTimes(1);
    expect(monitor).toHaveBeenCalledTimes(1);
    expect(result.summary).toContain('PASS');
  });

  it('fails and recommends gaps when an invariant unexpectedly breaks', async () => {
    const observation: ChaosObservation = {
      ...CLEAN_OBSERVATION,
      checkObservations: [{ id: 'availability', held: false }, { id: 'latency', held: false }]
    };
    const result = await runChaosExperiment(experiment(), { client: stubClient(), monitor: stubMonitor(observation) }, { now: () => new Date(INJECTED_AT) });
    expect(result.passed).toBe(false);
    expect(result.comparison.unexpectedBreaks).toEqual(['availability']);
    expect(result.gapRecommendations.some((r) => r.category === 'unexpected-break')).toBe(true);
  });

  it('halts the attack even when the monitor throws, then rethrows', async () => {
    const client = stubClient();
    const monitor: ChaosMonitor = jest.fn(async () => { throw new Error('monitor down'); });
    await expect(runChaosExperiment(experiment(), { client, monitor }, { now: () => new Date(INJECTED_AT) }))
      .rejects.toThrow('monitor down');
    expect(client.halt).toHaveBeenCalledTimes(1);
  });

  it('rethrows and does not halt when injection fails', async () => {
    const client: ChaosClient = {
      provider: 'gremlin',
      inject: jest.fn(async () => { throw new Error('inject failed'); }),
      halt: jest.fn(async () => undefined)
    };
    await expect(runChaosExperiment(experiment(), { client, monitor: stubMonitor(CLEAN_OBSERVATION) }, { now: () => new Date(INJECTED_AT) }))
      .rejects.toThrow('inject failed');
    expect(client.halt).not.toHaveBeenCalled();
  });

  it('does not throw from the run when halt fails during cleanup', async () => {
    const client: ChaosClient = {
      provider: 'gremlin',
      inject: jest.fn(async () => ({ attackId: 'a' })),
      halt: jest.fn(async () => { throw new Error('halt failed'); })
    };
    const result = await runChaosExperiment(experiment(), { client, monitor: stubMonitor(CLEAN_OBSERVATION) }, { now: () => new Date(INJECTED_AT) });
    expect(result.passed).toBe(true);
  });

  it('rejects a client whose provider does not match the experiment', async () => {
    await expect(runChaosExperiment(experiment(), { client: stubClient('chaos-monkey'), monitor: stubMonitor(CLEAN_OBSERVATION) }))
      .rejects.toThrow('does not match');
  });

  it('blocks a run outside low-traffic windows when required', async () => {
    await expect(runChaosExperiment(
      experiment(),
      { client: stubClient(), monitor: stubMonitor(CLEAN_OBSERVATION) },
      { now: () => new Date('2026-07-23T12:00:00.000Z'), lowTrafficWindows: [{ startHourUtc: 2, endHourUtc: 5 }], requireLowTrafficWindow: true }
    )).rejects.toThrow('outside all low-traffic windows');
  });

  it('allows a required run inside a low-traffic window', async () => {
    const result = await runChaosExperiment(
      experiment(),
      { client: stubClient(), monitor: stubMonitor(CLEAN_OBSERVATION) },
      { now: () => new Date(INJECTED_AT), lowTrafficWindows: [{ startHourUtc: 2, endHourUtc: 5 }], requireLowTrafficWindow: true }
    );
    expect(result.passed).toBe(true);
  });
});
