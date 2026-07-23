import {
  mapSeverity,
  routeAlert,
  shouldEscalate,
  formatPagerDutyEvent,
  formatOpsgenieAlert,
  buildOncallRequest,
  dispatchIncident,
  escalateIfUnacked,
  buildPostMortemSummary,
  attachPostMortem,
  createFetchOncallSender,
  DEFAULT_ROUTING_RULES,
  PAGERDUTY_EVENTS_URL,
  OPSGENIE_ALERTS_URL,
  type IncidentContext,
  type OncallSender,
  type OncallRequest,
  type FetchLike,
  type RoutingRule,
  type FollowUpTicketCreator,
  type PostMortemSummary
} from '../../src/core/sentinel-oncall.js';

function incident(overrides: Partial<IncidentContext> = {}): IncidentContext {
  return {
    title: 'Checkout error rate elevated',
    description: 'Checkout service returning 500s',
    service: 'checkout',
    errorRatePercent: 60,
    dedupKey: 'checkout-500s',
    links: {
      logs: 'https://logs.test/checkout',
      traces: 'https://traces.test/checkout',
      sentinelFindings: 'https://sentinel.test/f/1',
      testGapAnalysis: 'https://sentinel.test/gap/1'
    },
    remediationActions: [
      { label: 'Scale checkout to 50 replicas', type: 'scale', command: 'kubectl scale deploy/checkout --replicas=50' },
      { label: 'Rollback to last known good', type: 'rollback' }
    ],
    findings: ['z-score 4.1 for error_rate', 'likely cause: deploy abc1234'],
    ...overrides
  };
}

const okSender: () => OncallSender = () =>
  jest.fn<ReturnType<OncallSender>, [OncallRequest]>().mockResolvedValue({ ok: true, status: 202, incidentId: 'inc-1' });

const SECRETS = { routingKey: 'rk-secret', apiKey: 'og-secret' };

describe('mapSeverity', () => {
  it.each([
    [100, 'critical'],
    [50.1, 'critical'],
    [40, 'high'],
    [25.1, 'high'],
    [15, 'medium'],
    [10.1, 'medium'],
    [5, 'none'],
    [0, 'none']
  ])('maps %d%% to %s', (rate, expected) => {
    expect(mapSeverity(rate)).toBe(expected);
  });

  it.each([
    [50, 'high'],
    [25, 'medium'],
    [10, 'none']
  ])('treats exact boundary %d%% as %s (exclusive thresholds)', (rate, expected) => {
    expect(mapSeverity(rate)).toBe(expected);
  });

  it.each([Number.NaN, -1, 101, Number.POSITIVE_INFINITY])('rejects invalid error rate %p', (rate) => {
    expect(() => mapSeverity(rate)).toThrow('between 0 and 100');
  });
});

describe('routeAlert', () => {
  it('routes database errorType to the DBA team', () => {
    const rule = routeAlert(incident({ errorType: 'database' }));
    expect(rule.team).toBe('dba-team');
    expect(rule.manager).toBe('dba-manager');
  });

  it('routes on a database keyword in the title/description', () => {
    const rule = routeAlert(incident({ title: 'Database connection pool exhausted', errorType: undefined }));
    expect(rule.team).toBe('dba-team');
  });

  it('falls through to the catch-all platform team', () => {
    const rule = routeAlert(incident({ title: 'Latency spike', description: 'p99 up', errorType: 'network' }));
    expect(rule.team).toBe('platform-oncall');
  });

  it('matches an exact service rule', () => {
    const rules: RoutingRule[] = [
      { match: { service: 'payments' }, team: 'payments-oncall', escalationPolicy: 'pay-esc' },
      { match: {}, team: 'platform-oncall', escalationPolicy: 'platform-esc' }
    ];
    expect(routeAlert(incident({ service: 'payments' }), rules).team).toBe('payments-oncall');
  });

  it('throws when no rule matches', () => {
    const rules: RoutingRule[] = [{ match: { service: 'other' }, team: 't', escalationPolicy: 'e' }];
    expect(() => routeAlert(incident(), rules)).toThrow('No routing rule matched');
  });

  it('exposes frozen default routing rules', () => {
    expect(Object.isFrozen(DEFAULT_ROUTING_RULES)).toBe(true);
  });
});

describe('shouldEscalate', () => {
  const created = Date.parse('2026-07-23T12:00:00Z');

  it('escalates at exactly the 5-minute boundary when unacked', () => {
    expect(shouldEscalate(created, created + 5 * 60_000, false)).toBe(true);
  });

  it('does not escalate one millisecond before the boundary', () => {
    expect(shouldEscalate(created, created + 5 * 60_000 - 1, false)).toBe(false);
  });

  it('does not escalate an acknowledged incident even after the window', () => {
    expect(shouldEscalate(created, created + 10 * 60_000, true)).toBe(false);
  });

  it('honors a custom escalation window', () => {
    expect(shouldEscalate(created, created + 2 * 60_000, false, 2)).toBe(true);
    expect(shouldEscalate(created, created + 60_000, false, 2)).toBe(false);
  });

  it.each([
    [Number.NaN, created],
    [created, Number.NaN]
  ])('rejects non-finite timestamps', (a, b) => {
    expect(() => shouldEscalate(a, b, false)).toThrow('finite epoch');
  });

  it('rejects a non-positive escalation window', () => {
    expect(() => shouldEscalate(created, created, false, 0)).toThrow('positive');
  });

  it('rejects a now that precedes creation', () => {
    expect(() => shouldEscalate(created, created - 1, false)).toThrow('must not precede');
  });
});

describe('formatPagerDutyEvent', () => {
  it('builds a v2 trigger payload with mapped severity, links, and context', () => {
    const event = formatPagerDutyEvent(incident(), 'critical', 'rk-secret', 'dba-team');
    expect(event.event_action).toBe('trigger');
    expect(event.routing_key).toBe('rk-secret');
    expect(event.dedup_key).toBe('checkout-500s');
    expect(event.payload.severity).toBe('critical');
    expect(event.payload.source).toBe('checkout');
    expect(event.links).toHaveLength(4);
    expect(event.payload.custom_details['remediation_actions']).toContain('Scale checkout to 50 replicas');
    expect(event.payload.custom_details['test_gap_analysis']).toBe('https://sentinel.test/gap/1');
  });

  it('maps high -> error and medium -> warning', () => {
    expect(formatPagerDutyEvent(incident(), 'high', 'rk', 't').payload.severity).toBe('error');
    expect(formatPagerDutyEvent(incident(), 'medium', 'rk', 't').payload.severity).toBe('warning');
  });

  it('emits no links when none are supplied', () => {
    expect(formatPagerDutyEvent(incident({ links: undefined }), 'high', 'rk', 't').links).toHaveLength(0);
  });

  it('throws on an empty routing key', () => {
    expect(() => formatPagerDutyEvent(incident(), 'high', '  ', 't')).toThrow('routing key is required');
  });
});

describe('formatOpsgenieAlert', () => {
  it('builds an alert with mapped priority, responder team, and details', () => {
    const alert = formatOpsgenieAlert(incident({ errorType: 'database' }), 'critical', 'dba-team');
    expect(alert.priority).toBe('P1');
    expect(alert.alias).toBe('checkout-500s');
    expect(alert.responders).toEqual([{ name: 'dba-team', type: 'team' }]);
    expect(alert.tags).toContain('error-type:database');
    expect(alert.details['logs']).toBe('https://logs.test/checkout');
  });

  it.each([
    ['high', 'P2'],
    ['medium', 'P3']
  ] as const)('maps %s -> %s', (severity, priority) => {
    expect(formatOpsgenieAlert(incident(), severity, 't').priority).toBe(priority);
  });
});

describe('buildOncallRequest', () => {
  it('builds a PagerDuty request to the enqueue endpoint', () => {
    const request = buildOncallRequest('pagerduty', incident(), 'critical', 'dba-team', { routingKey: 'rk' });
    expect(request.url).toBe(PAGERDUTY_EVENTS_URL);
    expect(request.headers['Authorization']).toBeUndefined();
    expect(JSON.parse(request.body).routing_key).toBe('rk');
  });

  it('builds an Opsgenie request with a GenieKey auth header (secret not in body)', () => {
    const secret = 'sk-opsgenie-topsecret';
    const request = buildOncallRequest('opsgenie', incident(), 'high', 'dba-team', { apiKey: secret });
    expect(request.url).toBe(OPSGENIE_ALERTS_URL);
    expect(request.headers['Authorization']).toBe(`GenieKey ${secret}`);
    expect(request.body).not.toContain(secret);
  });

  it('reads PagerDuty routing key from env when not passed', () => {
    const request = buildOncallRequest('pagerduty', incident(), 'high', 't', { env: { PAGERDUTY_ROUTING_KEY: 'env-rk' } });
    expect(JSON.parse(request.body).routing_key).toBe('env-rk');
  });

  it('reads Opsgenie api key from env when not passed', () => {
    const request = buildOncallRequest('opsgenie', incident(), 'high', 't', { env: { OPSGENIE_API_KEY: 'env-og' } });
    expect(request.headers['Authorization']).toBe('GenieKey env-og');
  });

  it('throws when the PagerDuty routing key is missing', () => {
    expect(() => buildOncallRequest('pagerduty', incident(), 'high', 't', { env: {} })).toThrow('PAGERDUTY_ROUTING_KEY');
  });

  it('throws when the Opsgenie api key is missing', () => {
    expect(() => buildOncallRequest('opsgenie', incident(), 'high', 't', { env: {} })).toThrow('OPSGENIE_API_KEY');
  });
});

describe('dispatchIncident', () => {
  it('pages on-call via the injected sender and routes correctly', async () => {
    const sender = okSender();
    const result = await dispatchIncident({
      context: incident({ errorType: 'database' }),
      provider: 'pagerduty',
      sender,
      ...SECRETS
    });
    expect(result.paged).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.severity).toBe('critical');
    expect(result.team).toBe('dba-team');
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ provider: 'pagerduty', url: PAGERDUTY_EVENTS_URL }));
    expect(result.result?.incidentId).toBe('inc-1');
  });

  it('skips paging when severity is none (below threshold)', async () => {
    const sender = okSender();
    const result = await dispatchIncident({ context: incident({ errorRatePercent: 5 }), provider: 'opsgenie', sender, ...SECRETS });
    expect(result.skipped).toBe(true);
    expect(result.paged).toBe(false);
    expect(result.severity).toBe('none');
    expect(sender).not.toHaveBeenCalled();
  });

  it('reports a failed delivery without throwing', async () => {
    const sender: OncallSender = jest.fn().mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    const result = await dispatchIncident({ context: incident(), provider: 'opsgenie', sender, ...SECRETS });
    expect(result.paged).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toBe('boom');
  });

  it('captures a sender that throws', async () => {
    const sender: OncallSender = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await dispatchIncident({ context: incident(), provider: 'opsgenie', sender, ...SECRETS });
    expect(result.paged).toBe(false);
    expect(result.reason).toBe('network down');
  });

  it('propagates a missing-secret error', async () => {
    await expect(
      dispatchIncident({ context: incident(), provider: 'pagerduty', sender: okSender(), env: {} })
    ).rejects.toThrow('PAGERDUTY_ROUTING_KEY');
  });
});

describe('escalateIfUnacked', () => {
  const created = Date.parse('2026-07-23T12:00:00Z');

  it('escalates to the manager at the 5-minute boundary', async () => {
    const sender = okSender();
    const result = await escalateIfUnacked({
      context: incident(),
      provider: 'pagerduty',
      sender,
      createdAtMs: created,
      nowMs: created + 5 * 60_000,
      acknowledged: false,
      manager: 'checkout-manager',
      ...SECRETS
    });
    expect(result.escalated).toBe(true);
    const request = (sender as jest.Mock).mock.calls[0][0] as OncallRequest;
    const body = JSON.parse(request.body);
    expect(body.dedup_key).toBe('checkout-500s-escalation');
    expect(body.payload.summary).toContain('ESCALATION');
  });

  it('does not escalate before the window elapses', async () => {
    const sender = okSender();
    const result = await escalateIfUnacked({
      context: incident(),
      provider: 'pagerduty',
      sender,
      createdAtMs: created,
      nowMs: created + 60_000,
      acknowledged: false,
      manager: 'm',
      ...SECRETS
    });
    expect(result.escalated).toBe(false);
    expect(result.reason).toContain('window not elapsed');
    expect(sender).not.toHaveBeenCalled();
  });

  it('does not escalate an acknowledged incident', async () => {
    const sender = okSender();
    const result = await escalateIfUnacked({
      context: incident(),
      provider: 'opsgenie',
      sender,
      createdAtMs: created,
      nowMs: created + 30 * 60_000,
      acknowledged: true,
      manager: 'm',
      ...SECRETS
    });
    expect(result.escalated).toBe(false);
    expect(result.reason).toBe('Incident acknowledged');
  });

  it('upgrades a none-severity incident to high when escalating', async () => {
    const sender = okSender();
    await escalateIfUnacked({
      context: incident({ errorRatePercent: 5 }),
      provider: 'opsgenie',
      sender,
      createdAtMs: created,
      nowMs: created + 5 * 60_000,
      acknowledged: false,
      manager: 'ops-manager',
      ...SECRETS
    });
    const request = (sender as jest.Mock).mock.calls[0][0] as OncallRequest;
    expect(JSON.parse(request.body).priority).toBe('P2');
  });

  it('reports a failed escalation delivery', async () => {
    const sender: OncallSender = jest.fn().mockResolvedValue({ ok: false, status: 429, error: 'rate limited' });
    const result = await escalateIfUnacked({
      context: incident(),
      provider: 'pagerduty',
      sender,
      createdAtMs: created,
      nowMs: created + 5 * 60_000,
      acknowledged: false,
      manager: 'm',
      ...SECRETS
    });
    expect(result.escalated).toBe(false);
    expect(result.reason).toBe('rate limited');
  });

  it('captures a sender that throws during escalation', async () => {
    const sender: OncallSender = jest.fn().mockRejectedValue(new Error('boom'));
    const result = await escalateIfUnacked({
      context: incident(),
      provider: 'pagerduty',
      sender,
      createdAtMs: created,
      nowMs: created + 5 * 60_000,
      acknowledged: false,
      manager: 'm',
      ...SECRETS
    });
    expect(result.escalated).toBe(false);
    expect(result.reason).toBe('boom');
  });

  it('requires a manager', async () => {
    await expect(
      escalateIfUnacked({
        context: incident(),
        provider: 'pagerduty',
        sender: okSender(),
        createdAtMs: created,
        nowMs: created + 5 * 60_000,
        acknowledged: false,
        manager: ' ',
        ...SECRETS
      })
    ).rejects.toThrow('manager is required');
  });
});

describe('post-mortem', () => {
  function summary(): PostMortemSummary {
    return buildPostMortemSummary(incident({ errorType: 'database' }), {
      incidentId: 'inc-42',
      severity: 'critical',
      team: 'dba-team',
      timeline: ['12:00 detected', '12:00 paged', '12:05 escalated', '12:12 resolved']
    });
  }

  it('assembles a summary carrying findings, remediation, and links', () => {
    const result = summary();
    expect(result.incidentId).toBe('inc-42');
    expect(result.team).toBe('dba-team');
    expect(result.timeline).toHaveLength(4);
    expect(result.findings).toContain('z-score 4.1 for error_rate');
    expect(result.remediation[0]).toContain('Scale checkout to 50 replicas');
    expect(result.links.logs).toBe('https://logs.test/checkout');
  });

  it('defaults findings/remediation to empty arrays when absent', () => {
    const result = buildPostMortemSummary(incident({ findings: undefined, remediationActions: undefined, links: undefined }), {
      incidentId: 'inc-1',
      severity: 'high',
      team: 't',
      timeline: []
    });
    expect(result.findings).toEqual([]);
    expect(result.remediation).toEqual([]);
    expect(result.links).toEqual({});
  });

  it('throws on an empty incident id', () => {
    expect(() =>
      buildPostMortemSummary(incident(), { incidentId: '', severity: 'high', team: 't', timeline: [] })
    ).toThrow('incidentId is required');
  });

  it('attaches the summary to a follow-up ticket via the injected creator', async () => {
    const creator: FollowUpTicketCreator = jest.fn().mockResolvedValue({ ticketKey: 'OPS-9', url: 'https://jira/OPS-9' });
    const result = await attachPostMortem(summary(), creator);
    expect(result.attached).toBe(true);
    expect(result.ticket?.ticketKey).toBe('OPS-9');
    expect(creator).toHaveBeenCalledWith(expect.objectContaining({ incidentId: 'inc-42' }));
  });

  it('reports a failed ticket creation', async () => {
    const creator: FollowUpTicketCreator = jest.fn().mockRejectedValue(new Error('jira down'));
    const result = await attachPostMortem(summary(), creator);
    expect(result.attached).toBe(false);
    expect(result.reason).toBe('jira down');
  });

  it('treats an empty ticket key as a failure', async () => {
    const creator: FollowUpTicketCreator = jest.fn().mockResolvedValue({ ticketKey: '  ' });
    const result = await attachPostMortem(summary(), creator);
    expect(result.attached).toBe(false);
    expect(result.reason).toContain('empty ticket key');
  });
});

describe('createFetchOncallSender', () => {
  function request(provider: OncallRequest['provider']): OncallRequest {
    return { provider, url: 'https://x', method: 'POST', headers: {}, body: '{}' };
  }

  it('POSTs and extracts the PagerDuty dedup_key', async () => {
    const fetchImpl: FetchLike = jest.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ dedup_key: 'pd-1' }) });
    const sender = createFetchOncallSender(fetchImpl);
    const result = await sender(request('pagerduty'));
    expect(result.ok).toBe(true);
    expect(result.incidentId).toBe('pd-1');
    expect(fetchImpl).toHaveBeenCalledWith('https://x', expect.objectContaining({ method: 'POST' }));
  });

  it('extracts the Opsgenie requestId', async () => {
    const fetchImpl: FetchLike = jest.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ requestId: 'og-1' }) });
    const result = await createFetchOncallSender(fetchImpl)(request('opsgenie'));
    expect(result.incidentId).toBe('og-1');
  });

  it('maps a non-ok response to an error', async () => {
    const fetchImpl: FetchLike = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const result = await createFetchOncallSender(fetchImpl)(request('pagerduty'));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('400');
  });

  it('still succeeds on a 2xx with an unparseable body', async () => {
    const fetchImpl: FetchLike = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => { throw new Error('bad json'); }
    });
    const result = await createFetchOncallSender(fetchImpl)(request('pagerduty'));
    expect(result.ok).toBe(true);
    expect(result.incidentId).toBeUndefined();
  });

  it('catches network errors and returns status 0', async () => {
    const fetchImpl: FetchLike = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await createFetchOncallSender(fetchImpl)(request('opsgenie'));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain('network down');
  });
});
