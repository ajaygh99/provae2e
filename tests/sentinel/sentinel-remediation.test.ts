import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelRemediationEngine,
  parseRemediationRules,
  type ActionExecutionResult,
  type RemediationAction,
  type RemediationExecutor,
  type RemediationRule
} from '../../src/core/sentinel-remediation.js';

const dir = path.join(process.cwd(), '.test-remediation');
let sequence = 0;
let clock = Date.parse('2026-07-23T12:00:00Z');
const now = (): Date => new Date(clock);
const rule: RemediationRule = {
  id: 'latency-scale',
  trigger: { metric: 'latency_seconds', operator: '>', threshold: 2, forSeconds: 30 },
  actions: [{ type: 'scale', target: 'checkout', value: 50, endpoint: 'https://k8s.test/scale', risky: true }],
  timeoutSeconds: 120,
  escalation: 'payments-oncall'
};

class FakeExecutor implements RemediationExecutor {
  readonly actions: RemediationAction[] = [];
  readonly pages: string[] = [];
  result: ActionExecutionResult = { success: true, message: 'executed' };

  async execute(action: RemediationAction): Promise<ActionExecutionResult> {
    this.actions.push(action);
    return this.result;
  }

  async pageOnCall(target: string, reason: string): Promise<ActionExecutionResult> {
    this.pages.push(`${target}:${reason}`);
    return { success: true, message: 'paged' };
  }
}

async function engine(
  rules = [rule],
  options: { dryRun?: boolean; executor?: FakeExecutor } = {}
): Promise<{ engine: SentinelRemediationEngine; executor: FakeExecutor }> {
  sequence += 1;
  const executor = options.executor ?? new FakeExecutor();
  return {
    engine: await SentinelRemediationEngine.open(
      path.join(dir, `${sequence}.db`),
      rules,
      executor,
      { dryRun: options.dryRun, now }
    ),
    executor
  };
}

const triggered = {
  metric: 'latency_seconds',
  value: 2.5,
  sustainedSeconds: 30,
  slaBudgetAvailable: true
};

beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));
beforeEach(() => { clock = Date.parse('2026-07-23T12:00:00Z'); });

describe('remediation rules', () => {
  it('parses YAML rules', () => {
    const parsed = parseRemediationRules(`
rules:
  - id: latency-scale
    trigger: { metric: latency_seconds, operator: ">", threshold: 2, forSeconds: 30 }
    actions:
      - { type: scale, target: checkout, value: 50, risky: true }
    timeoutSeconds: 120
    escalation: payments-oncall
`);
    expect(parsed[0]?.id).toBe('latency-scale');
  });

  it('rejects malformed YAML', () => expect(() => parseRemediationRules('rules: [')).toThrow('Invalid'));
  it('requires rules array', () => expect(() => parseRemediationRules('name: test')).toThrow('rules[]'));
  it('requires at least one rule', () => expect(() => parseRemediationRules('rules: []')).toThrow('At least'));
  it('rejects duplicate ids', async () => expect(engine([rule, rule])).rejects.toThrow('Duplicate'));
  it('requires rule id', async () => expect(engine([{ ...rule, id: '' }])).rejects.toThrow('rule.id'));
  it('requires trigger metric', async () => expect(engine([{ ...rule, trigger: { ...rule.trigger, metric: '' } }])).rejects.toThrow('trigger.metric'));
  it('rejects invalid operator', async () => expect(engine([{ ...rule, trigger: { ...rule.trigger, operator: '=' as '>' } }])).rejects.toThrow('operator'));
  it('rejects invalid threshold', async () => expect(engine([{ ...rule, trigger: { ...rule.trigger, threshold: Number.NaN } }])).rejects.toThrow('threshold'));
  it('rejects invalid duration', async () => expect(engine([{ ...rule, trigger: { ...rule.trigger, forSeconds: 0 } }])).rejects.toThrow('forSeconds'));
  it('rejects invalid timeout', async () => expect(engine([{ ...rule, timeoutSeconds: 0 }])).rejects.toThrow('timeout'));
  it('requires escalation', async () => expect(engine([{ ...rule, escalation: '' }])).rejects.toThrow('escalation'));
  it('requires actions', async () => expect(engine([{ ...rule, actions: [] }])).rejects.toThrow('actions'));
  it('rejects invalid action', async () => expect(engine([{ ...rule, actions: [{ type: 'delete' as 'scale', target: 'x' }] }])).rejects.toThrow('Invalid remediation'));
  it('requires action target', async () => expect(engine([{ ...rule, actions: [{ type: 'scale', target: '' }] }])).rejects.toThrow('action.target'));
  it.each(['bad', 'ftp://test.local'])('rejects invalid endpoint %s', async endpoint => {
    await expect(engine([{ ...rule, actions: [{ type: 'scale', target: 'x', endpoint }] }]))
      .rejects.toThrow('HTTP/HTTPS');
  });
  it('surfaces database read errors', async () => {
    const databasePath = path.join(dir, 'directory.db');
    await mkdir(databasePath, { recursive: true });
    await expect(SentinelRemediationEngine.open(databasePath, [rule], new FakeExecutor())).rejects.toThrow();
  });
});

describe('remediation execution', () => {
  it.each([
    [{ ...triggered, value: 2 }, 'not-triggered'],
    [{ ...triggered, sustainedSeconds: 29 }, 'not-triggered'],
    [{ ...triggered, metric: 'errors' }, 'not-triggered']
  ])('does not execute when trigger is unmet', async (observation, status) => {
    const value = await engine();
    expect((await value.engine.evaluate(rule.id, observation)).status).toBe(status);
    expect(value.executor.actions).toHaveLength(0);
  });

  it.each([
    ['>', 3, 2],
    ['>=', 2, 2],
    ['<', 1, 2],
    ['<=', 2, 2]
  ] as const)('supports operator %s', async (operator, value, threshold) => {
    const configured = { ...rule, trigger: { ...rule.trigger, operator, threshold } };
    expect((await (await engine([configured])).engine.evaluate(rule.id, { ...triggered, value })).triggered).toBe(true);
  });

  it('executes a 50 percent scale action', async () => {
    const value = await engine();
    const run = await value.engine.evaluate(rule.id, triggered);
    expect(run.status).toBe('completed');
    expect(value.executor.actions[0]).toMatchObject({ type: 'scale', value: 50 });
  });

  it('previews without executing in dry-run mode', async () => {
    const value = await engine([rule], { dryRun: true });
    const run = await value.engine.evaluate(rule.id, triggered);
    expect(run.status).toBe('previewed');
    expect(value.executor.actions).toHaveLength(0);
    expect(run.actions[0]?.detail).toContain('Dry-run');
  });

  it('blocks risky actions without SLA budget', async () => {
    const value = await engine();
    const run = await value.engine.evaluate(rule.id, { ...triggered, slaBudgetAvailable: false });
    expect(run.status).toBe('blocked');
    expect(run.actions[0]?.result).toBe('blocked');
  });

  it('allows non-risky actions without SLA budget', async () => {
    const safeRule = { ...rule, actions: [{ type: 'circuit-breaker' as const, target: 'checkout' }] };
    const value = await engine([safeRule]);
    expect((await value.engine.evaluate(rule.id, { ...triggered, slaBudgetAvailable: false })).status).toBe('completed');
  });

  it('trips circuit breaker on error threshold', async () => {
    const circuitRule: RemediationRule = {
      ...rule,
      trigger: { metric: 'error_rate', operator: '>', threshold: 50, forSeconds: 1 },
      actions: [{ type: 'circuit-breaker', target: 'checkout', value: 'open' }]
    };
    const value = await engine([circuitRule]);
    await value.engine.evaluate(rule.id, { metric: 'error_rate', value: 51, sustainedSeconds: 1, slaBudgetAvailable: true });
    expect(value.executor.actions[0]?.type).toBe('circuit-breaker');
  });

  it('resolves rollback to last known-good deployment', async () => {
    const rollbackRule = { ...rule, actions: [{ type: 'rollback' as const, target: 'checkout', risky: true }] };
    const value = await engine([rollbackRule]);
    await value.engine.evaluate(rule.id, { ...triggered, lastKnownGoodDeployment: 'deploy-42' });
    expect(value.executor.actions[0]?.value).toBe('deploy-42');
  });

  it('requires a known-good deployment for rollback', async () => {
    const rollbackRule = { ...rule, actions: [{ type: 'rollback' as const, target: 'checkout' }] };
    await expect((await engine([rollbackRule])).engine.evaluate(rule.id, triggered))
      .rejects.toThrow('lastKnownGoodDeployment');
  });

  it('records failed executor results', async () => {
    const executor = new FakeExecutor();
    executor.result = { success: false, message: 'webhook rejected' };
    const run = await (await engine([rule], { executor })).engine.evaluate(rule.id, triggered);
    expect(run.status).toBe('failed');
    expect(run.actions[0]?.detail).toBe('webhook rejected');
  });

  it('executes multiple actions', async () => {
    const multi = { ...rule, actions: [
      { type: 'restart' as const, target: 'checkout' },
      { type: 'failover' as const, target: 'checkout-secondary' }
    ] };
    const value = await engine([multi]);
    await value.engine.evaluate(rule.id, triggered);
    expect(value.executor.actions).toHaveLength(2);
  });

  it('rejects unknown rule', async () => {
    await expect((await engine()).engine.evaluate('missing', triggered)).rejects.toThrow('Unknown');
  });

  it.each([
    [{ ...triggered, metric: '' }, 'metric'],
    [{ ...triggered, value: Number.NaN }, 'value'],
    [{ ...triggered, sustainedSeconds: -1 }, 'sustainedSeconds']
  ])('validates observations', async (observation, message) => {
    await expect((await engine()).engine.evaluate(rule.id, observation)).rejects.toThrow(message);
  });

  it('records timestamp and reasoning in immutable audit', async () => {
    const value = await engine();
    const run = await value.engine.evaluate(rule.id, triggered);
    const audit = value.engine.auditLog(run.runId);
    expect(audit[0]).toMatchObject({
      actor: 'sentinel',
      timestamp: '2026-07-23T12:00:00.000Z',
      reasoning: 'latency_seconds > 2 for 30s'
    });
  });

  it('returns the complete audit log', async () => {
    const value = await engine();
    await value.engine.evaluate(rule.id, triggered);
    await value.engine.evaluate(rule.id, triggered);
    expect(value.engine.auditLog()).toHaveLength(2);
  });
});

describe('escalation', () => {
  it('pages on-call after two minutes unresolved', async () => {
    const value = await engine();
    await value.engine.evaluate(rule.id, triggered);
    clock += 120_000;
    const escalations = await value.engine.escalateOverdue();
    expect(escalations[0]?.result).toBe('escalated');
    expect(value.executor.pages[0]).toContain('payments-oncall');
  });

  it('does not escalate before timeout', async () => {
    const value = await engine();
    await value.engine.evaluate(rule.id, triggered);
    clock += 119_000;
    expect(await value.engine.escalateOverdue()).toHaveLength(0);
  });

  it('does not escalate resolved runs', async () => {
    const value = await engine();
    const run = await value.engine.evaluate(rule.id, triggered);
    expect(await value.engine.markResolved(run.runId)).toBe(true);
    clock += 120_000;
    expect(await value.engine.escalateOverdue()).toHaveLength(0);
  });

  it('returns false resolving an unknown run', async () => {
    expect(await (await engine()).engine.markResolved('missing')).toBe(false);
  });

  it('does not escalate dry-run previews', async () => {
    const value = await engine([rule], { dryRun: true });
    await value.engine.evaluate(rule.id, triggered);
    clock += 120_000;
    expect(await value.engine.escalateOverdue()).toHaveLength(0);
  });

  it('escalates a run only once', async () => {
    const value = await engine();
    await value.engine.evaluate(rule.id, triggered);
    clock += 120_000;
    expect(await value.engine.escalateOverdue()).toHaveLength(1);
    expect(await value.engine.escalateOverdue()).toHaveLength(0);
  });

  it('persists audit evidence across reopen', async () => {
    const databasePath = path.join(dir, 'persist.db');
    const executor = new FakeExecutor();
    const first = await SentinelRemediationEngine.open(databasePath, [rule], executor, { now });
    const run = await first.evaluate(rule.id, triggered);
    const reopened = await SentinelRemediationEngine.open(databasePath, [rule], executor, { now });
    expect(reopened.auditLog(run.runId)).toHaveLength(1);
  });

  it('rejects an invalid clock', async () => {
    const value = await SentinelRemediationEngine.open(
      path.join(dir, 'bad-clock.db'),
      [rule],
      new FakeExecutor(),
      { now: () => new Date('invalid') }
    );
    await expect(value.evaluate(rule.id, triggered)).rejects.toThrow('Current time');
  });
});
