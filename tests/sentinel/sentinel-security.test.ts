import {
  SentinelSecurityMonitor,
  formatSiem,
  actionsForLevel,
  DEFAULT_TRAVEL_WINDOW_MS,
  type SecurityEvent,
  type SecurityResponder,
  type SecurityActionResult,
  type SecurityActionType,
  type SiemForwarder,
  type SecurityAuditRecord
} from '../../src/core/sentinel-security.js';

let eventCounter = 0;

function event(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  eventCounter += 1;
  return {
    id: `evt-${eventCounter}`,
    timestamp: '2026-07-23T10:00:00.000Z',
    type: 'login',
    sourceIp: '203.0.113.7',
    ...overrides
  };
}

/** Records every action call and returns a configurable outcome. */
class FakeResponder implements SecurityResponder {
  readonly calls: Array<{ action: SecurityActionType; arg: string }> = [];
  constructor(private readonly outcome: SecurityActionResult = { success: true, detail: 'ok' }) {}
  async blockIp(ip: string): Promise<SecurityActionResult> {
    this.calls.push({ action: 'block-ip', arg: ip });
    return this.outcome;
  }
  async revokeSession(userId: string): Promise<SecurityActionResult> {
    this.calls.push({ action: 'revoke-session', arg: userId });
    return this.outcome;
  }
  async rotateCredentials(userId: string): Promise<SecurityActionResult> {
    this.calls.push({ action: 'rotate-credentials', arg: userId });
    return this.outcome;
  }
  async pageSecurity(summary: string): Promise<SecurityActionResult> {
    this.calls.push({ action: 'page-security', arg: summary });
    return this.outcome;
  }
}

/** Ingests N login events one millisecond apart starting at a base time. */
async function floodLogins(monitor: SentinelSecurityMonitor, count: number, baseMs = 0): Promise<SecurityEvent[]> {
  const results: SecurityEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const login = event({
      type: 'login',
      timestamp: new Date(baseMs + index).toISOString(),
      sourceIp: '198.51.100.4'
    });
    results.push(login);
    await monitor.ingest(login);
  }
  return results;
}

describe('rate-based detection', () => {
  it('does not alert at exactly 100 logins in a minute', async () => {
    const monitor = new SentinelSecurityMonitor();
    let last: unknown[] = [];
    for (let index = 0; index < 100; index += 1) {
      last = await monitor.ingest(event({ type: 'login', timestamp: new Date(index).toISOString() }));
    }
    expect(last).toEqual([]);
    expect(monitor.auditTrail()).toEqual([]);
  });

  it('alerts when logins exceed 100 in a minute', async () => {
    const monitor = new SentinelSecurityMonitor();
    for (let index = 0; index < 100; index += 1) {
      await monitor.ingest(event({ type: 'login', timestamp: new Date(index).toISOString() }));
    }
    const detections = await monitor.ingest(event({ type: 'login', timestamp: new Date(100).toISOString() }));
    expect(detections).toHaveLength(1);
    expect(detections[0].rule).toBe('rate');
    expect(detections[0].ruleId).toBe('login-burst');
    expect(detections[0].alertLevel).toBe('confirmed');
  });

  it('does not re-alert while the rate breach persists', async () => {
    const monitor = new SentinelSecurityMonitor();
    await floodLogins(monitor, 101);
    const again = await monitor.ingest(event({ type: 'login', timestamp: new Date(102).toISOString(), sourceIp: '198.51.100.4' }));
    expect(again).toEqual([]);
  });

  it('re-arms after the count recovers below threshold', async () => {
    const monitor = new SentinelSecurityMonitor();
    await floodLogins(monitor, 101);
    // A lone event well past the window drops the count below threshold and re-arms.
    const recovered = await monitor.ingest(event({ type: 'login', timestamp: new Date(200_000).toISOString(), sourceIp: '198.51.100.4' }));
    expect(recovered).toEqual([]);
    let refired = false;
    for (let index = 0; index < 101; index += 1) {
      const detections = await monitor.ingest(event({
        type: 'login', timestamp: new Date(200_001 + index).toISOString(), sourceIp: '198.51.100.4'
      }));
      if (detections.some(detection => detection.ruleId === 'login-burst')) refired = true;
    }
    expect(refired).toBe(true);
  });

  it('counts API floods per IP against the 1000/min rule', async () => {
    const monitor = new SentinelSecurityMonitor();
    let detections: unknown[] = [];
    for (let index = 0; index <= 1000; index += 1) {
      detections = await monitor.ingest(event({
        type: 'api-request',
        sourceIp: '198.51.100.9',
        timestamp: new Date(index).toISOString()
      }));
    }
    expect(detections).toHaveLength(1);
    expect((detections[0] as { ruleId: string }).ruleId).toBe('api-flood');
  });

  it('supports custom rate rules', async () => {
    const monitor = new SentinelSecurityMonitor({
      rateRules: [{ id: 'tiny', eventType: 'login', groupBy: 'ip', windowMs: 1000, threshold: 1, level: 'suspicious' }]
    });
    await monitor.ingest(event({ type: 'login', timestamp: new Date(0).toISOString() }));
    const detections = await monitor.ingest(event({ type: 'login', timestamp: new Date(1).toISOString() }));
    expect(detections[0].ruleId).toBe('tiny');
    expect(detections[0].alertLevel).toBe('suspicious');
  });
});

describe('pattern-based detection (SQLi)', () => {
  it.each([
    "' OR 1=1 --",
    'UNION SELECT password FROM users',
    'DROP TABLE customers',
    "admin'--"
  ])('flags SQL injection signature %s', async payload => {
    const monitor = new SentinelSecurityMonitor();
    const detections = await monitor.ingest(event({ type: 'query', message: payload }));
    expect(detections).toHaveLength(1);
    expect(detections[0].rule).toBe('sqli');
    expect(detections[0].alertLevel).toBe('confirmed');
  });

  it('ignores benign queries', async () => {
    const monitor = new SentinelSecurityMonitor();
    const detections = await monitor.ingest(event({ type: 'query', message: 'SELECT name FROM catalog WHERE id = 42' }));
    expect(detections).toEqual([]);
  });

  it('treats a missing message as benign', async () => {
    const monitor = new SentinelSecurityMonitor();
    expect(await monitor.ingest(event({ type: 'query' }))).toEqual([]);
  });
});

describe('behavioral impossible-travel detection', () => {
  it('flags the same user in two countries under one hour', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ type: 'login', userId: 'u1', country: 'US', timestamp: '2026-07-23T10:00:00.000Z' }));
    const detections = await monitor.ingest(event({
      type: 'login', userId: 'u1', country: 'DE', timestamp: '2026-07-23T10:59:59.000Z'
    }));
    expect(detections.some(d => d.rule === 'impossible-travel')).toBe(true);
    const travel = detections.find(d => d.rule === 'impossible-travel');
    expect(travel?.alertLevel).toBe('critical');
  });

  it('does not flag when exactly one hour apart', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ type: 'login', userId: 'u2', country: 'US', timestamp: new Date(0).toISOString() }));
    const detections = await monitor.ingest(event({
      type: 'login', userId: 'u2', country: 'DE', timestamp: new Date(DEFAULT_TRAVEL_WINDOW_MS).toISOString()
    }));
    expect(detections.some(d => d.rule === 'impossible-travel')).toBe(false);
  });

  it('does not flag the same country', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ type: 'login', userId: 'u3', country: 'US', timestamp: new Date(0).toISOString() }));
    const detections = await monitor.ingest(event({
      type: 'login', userId: 'u3', country: 'US', timestamp: new Date(1000).toISOString()
    }));
    expect(detections.some(d => d.rule === 'impossible-travel')).toBe(false);
  });

  it('ignores events without a country', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ userId: 'u4', country: 'US' }));
    const detections = await monitor.ingest(event({ userId: 'u4', timestamp: '2026-07-23T10:10:00.000Z' }));
    expect(detections.some(d => d.rule === 'impossible-travel')).toBe(false);
  });
});

describe('alert-level to auto-action mapping', () => {
  it('takes no action for suspicious alerts', () => {
    expect(actionsForLevel('suspicious')).toEqual([]);
  });

  it('blocks and revokes for confirmed alerts', () => {
    expect(actionsForLevel('confirmed')).toEqual(['block-ip', 'revoke-session']);
  });

  it('runs full incident response for critical alerts', () => {
    expect(actionsForLevel('critical')).toEqual(['block-ip', 'revoke-session', 'rotate-credentials', 'page-security']);
  });

  it('executes block and revoke on a confirmed SQLi detection', async () => {
    const responder = new FakeResponder();
    const monitor = new SentinelSecurityMonitor({ responder });
    const detections = await monitor.ingest(event({ type: 'query', userId: 'u5', message: "' OR 1=1--" }));
    expect(responder.calls.map(call => call.action)).toEqual(['block-ip', 'revoke-session']);
    expect(detections[0].actions.every(action => action.outcome === 'succeeded')).toBe(true);
  });

  it('pages security and rotates credentials on a critical detection', async () => {
    const responder = new FakeResponder();
    const monitor = new SentinelSecurityMonitor({ responder });
    await monitor.ingest(event({ type: 'login', userId: 'u6', country: 'US', timestamp: new Date(0).toISOString() }));
    await monitor.ingest(event({ type: 'login', userId: 'u6', country: 'FR', timestamp: new Date(1000).toISOString() }));
    expect(responder.calls.map(call => call.action)).toEqual([
      'block-ip', 'revoke-session', 'rotate-credentials', 'page-security'
    ]);
  });

  it('skips user-scoped actions when no user is known', async () => {
    const responder = new FakeResponder();
    const monitor = new SentinelSecurityMonitor({ responder });
    await monitor.ingest(event({ type: 'query', message: 'UNION SELECT 1' }));
    expect(responder.calls.map(call => call.action)).toEqual(['block-ip']);
  });

  it('records planned actions when no responder is injected', async () => {
    const monitor = new SentinelSecurityMonitor();
    const detections = await monitor.ingest(event({ type: 'query', userId: 'u7', message: 'DROP TABLE t' }));
    expect(detections[0].actions.every(action => action.outcome === 'planned')).toBe(true);
  });

  it('records a failed outcome when an action throws', async () => {
    const responder = new FakeResponder();
    responder.blockIp = async (): Promise<SecurityActionResult> => {
      throw new Error('firewall unreachable');
    };
    const monitor = new SentinelSecurityMonitor({ responder });
    const detections = await monitor.ingest(event({ type: 'query', message: 'DROP TABLE t' }));
    const blockRecord = detections[0].actions.find(action => action.action === 'block-ip');
    expect(blockRecord?.outcome).toBe('failed');
    expect(blockRecord?.detail).toContain('firewall unreachable');
  });

  it('records a failed outcome when an action reports failure', async () => {
    const responder = new FakeResponder({ success: false, detail: 'denied' });
    const monitor = new SentinelSecurityMonitor({ responder });
    const detections = await monitor.ingest(event({ type: 'query', message: 'DROP TABLE t' }));
    expect(detections[0].actions[0].outcome).toBe('failed');
  });
});

describe('immutable audit trail', () => {
  it('captures who, what, when, where, and why', async () => {
    const responder = new FakeResponder();
    const monitor = new SentinelSecurityMonitor({ responder });
    await monitor.ingest(event({ type: 'query', userId: 'alice', sourceIp: '10.0.0.1', message: "' OR 1=1--" }));
    const [detection] = monitor.auditTrail();
    expect(detection).toMatchObject({
      actor: 'alice',
      sourceIp: '10.0.0.1',
      rule: 'sqli',
      action: 'detect',
      outcome: 'detected'
    });
    expect(detection.reason).toContain('SQL injection');
    expect(Number.isFinite(Date.parse(detection.timestamp))).toBe(true);
  });

  it('assigns monotonic sequence numbers and is a defensive copy', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ type: 'query', message: 'DROP TABLE a' }));
    const trail = monitor.auditTrail();
    trail[0].actor = 'tampered';
    expect(monitor.auditTrail()[0].actor).not.toBe('tampered');
    expect(monitor.auditTrail().map(record => record.sequence)).toEqual([1, 2]);
  });
});

describe('SIEM export', () => {
  let trail: SecurityAuditRecord[];

  beforeAll(async () => {
    const monitor = new SentinelSecurityMonitor({ responder: new FakeResponder() });
    await monitor.ingest(event({ type: 'query', userId: 'bob', message: 'DROP TABLE x' }));
    trail = monitor.auditTrail();
  });

  it('formats Splunk key=value lines', () => {
    const output = formatSiem(trail, 'splunk');
    expect(output.split('\n')).toHaveLength(trail.length);
    expect(output).toContain('rule=sqli');
    expect(output).toContain('level=confirmed');
  });

  it('formats ELK NDJSON with ECS fields', () => {
    const output = formatSiem(trail, 'elk');
    const first = JSON.parse(output.split('\n')[0]) as Record<string, unknown>;
    expect(first['rule.name']).toBe('sqli');
    expect(first['source.ip']).toBe('203.0.113.7');
    expect(first['event.kind']).toBe('alert');
  });

  it('rejects an unsupported SIEM format', () => {
    expect(() => formatSiem(trail, 'datadog' as 'splunk')).toThrow('Unsupported SIEM format');
  });

  it('exposes exportSiem on the monitor', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ type: 'query', message: 'DROP TABLE y' }));
    expect(monitor.exportSiem('splunk')).toContain('rule=sqli');
  });

  it('forwards records to an injected SIEM forwarder', async () => {
    const forwarded: SecurityAuditRecord[] = [];
    const siem: SiemForwarder = { forward: async (record): Promise<void> => { forwarded.push(record); } };
    const monitor = new SentinelSecurityMonitor({ siem });
    await monitor.ingest(event({ type: 'query', message: 'DROP TABLE z' }));
    await Promise.resolve();
    expect(forwarded.length).toBeGreaterThan(0);
    expect(forwarded[0].rule).toBe('sqli');
  });

  it('does not throw when SIEM forwarding fails', async () => {
    const siem: SiemForwarder = { forward: async () => { throw new Error('siem down'); } };
    const monitor = new SentinelSecurityMonitor({ siem });
    await expect(monitor.ingest(event({ type: 'query', message: 'DROP TABLE w' }))).resolves.toBeDefined();
  });
});

describe('compliance evidence', () => {
  it('maps SOC2 controls to detection and response evidence', async () => {
    const monitor = new SentinelSecurityMonitor({
      responder: new FakeResponder(),
      now: (): Date => new Date('2026-07-23T12:00:00.000Z')
    });
    await monitor.ingest(event({ type: 'query', userId: 'carol', message: "' OR 1=1--" }));
    const report = monitor.complianceEvidence('SOC2');
    expect(report.framework).toBe('SOC2');
    expect(report.generatedAt).toBe('2026-07-23T12:00:00.000Z');
    expect(report.controls.find(c => c.id === 'CC7.2')?.satisfied).toBe(true);
    expect(report.controls.find(c => c.id === 'CC7.4')?.satisfied).toBe(true);
    expect(report.totalAuditRecords).toBe(3);
  });

  it('maps ISO27001 controls', async () => {
    const monitor = new SentinelSecurityMonitor();
    await monitor.ingest(event({ type: 'query', message: 'DROP TABLE t' }));
    const report = monitor.complianceEvidence('ISO27001');
    expect(report.controls.map(c => c.id)).toContain('A.16.1.4');
  });

  it('reports unsatisfied controls when nothing has been detected', () => {
    const monitor = new SentinelSecurityMonitor();
    const report = monitor.complianceEvidence('SOC2');
    expect(report.controls.every(c => c.satisfied === false)).toBe(true);
    expect(report.totalAuditRecords).toBe(0);
  });
});

describe('input validation', () => {
  it.each([
    [{ id: '' }, 'event.id'],
    [{ sourceIp: '' }, 'event.sourceIp'],
    [{ timestamp: 'nope' }, 'event.timestamp'],
    [{ type: 'weird' as SecurityEvent['type'] }, 'Unsupported event type'],
    [{ userId: '  ' }, 'event.userId'],
    [{ country: ' ' }, 'event.country']
  ])('rejects malformed events (%o)', async (override, expected) => {
    const monitor = new SentinelSecurityMonitor();
    await expect(monitor.ingest(event(override))).rejects.toThrow(expected);
  });

  it.each([
    [{ id: '' }, 'rateRule.id'],
    [{ eventType: 'weird' as SecurityEvent['type'] }, 'event type'],
    [{ groupBy: 'zone' as 'ip' }, 'groupBy'],
    [{ windowMs: 0 }, 'windowMs'],
    [{ threshold: -1 }, 'threshold'],
    [{ level: 'meh' as 'confirmed' }, 'alert level']
  ])('rejects malformed rate rules (%o)', (override, expected) => {
    expect(() => new SentinelSecurityMonitor({
      rateRules: [{ id: 'r', eventType: 'login', groupBy: 'ip', windowMs: 1000, threshold: 1, level: 'confirmed', ...override }]
    })).toThrow(expected);
  });

  it('rejects a non-positive travel window', () => {
    expect(() => new SentinelSecurityMonitor({ travelWindowMs: 0 })).toThrow('travelWindowMs');
  });
});
