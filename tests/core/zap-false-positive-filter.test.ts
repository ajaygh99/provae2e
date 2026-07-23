import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ZapFalsePositiveFilter,
  parseZapFilterRules,
  zapFindingKey,
  type ZapFinding
} from '../../src/core/zap-false-positive-filter';

const finding = (overrides: Partial<ZapFinding> = {}): ZapFinding => ({
  alertId: '40012',
  name: 'Cross Site Scripting',
  cwe: '79',
  url: 'https://app.example.test/search?q=test',
  risk: 'HIGH',
  parameter: 'q',
  ...overrides
});

describe('ZAP rule parsing', () => {
  it('parses documented snake-case YAML and normalizes risk', () => {
    expect(parseZapFilterRules(`
rules:
  - alert_id: "40012"
    url_pattern: "https://app.example.test/test/*"
    action: ignore
    reason: Intentional XSS fixture
  - risk: info
    action: ignore
`)).toEqual([
      { alertId: '40012', urlPattern: 'https://app.example.test/test/*', action: 'ignore', reason: 'Intentional XSS fixture' },
      { risk: 'INFO', action: 'ignore' }
    ]);
  });

  it('rejects malformed YAML and unsafe catch-all rules', () => {
    expect(() => parseZapFilterRules('rules: [')).toThrow('Invalid ZAP filter YAML');
    expect(() => parseZapFilterRules('value: true')).toThrow('rules array');
    expect(() => parseZapFilterRules('rules:\n - action: ignore')).toThrow('at least one matcher');
    expect(() => parseZapFilterRules('rules:\n - risk: UNKNOWN\n   action: ignore')).toThrow('risk is invalid');
    expect(() => parseZapFilterRules('rules:\n - cwe: 79\n   action: ignore')).toThrow('at least one matcher');
  });
});

describe('ZapFalsePositiveFilter', () => {
  it('establishes the first baseline then highlights only newly introduced findings', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-zap-baseline-'));
    let time = Date.UTC(2026, 0, 1);
    const engine = await ZapFalsePositiveFilter.open(path.join(directory, 'zap.sqlite'), () => new Date(time++));
    const original = finding();
    const first = await engine.processScan('staging', [original]);
    expect(first.baselineEstablished).toBe(true);
    expect(first.newFindings).toEqual([]);
    const added = finding({ alertId: '10020', name: 'Missing CSP', risk: 'MEDIUM', cwe: '693' });
    const next = await engine.processScan('staging', [original, added]);
    expect(next.baselineEstablished).toBe(false);
    expect(next.newFindings.map(item => item.finding.alertId)).toEqual(['10020']);
    expect((await readFile(path.join(directory, 'zap.sqlite'))).subarray(0, 6).toString()).toBe('SQLite');
  });

  it('establishes an empty baseline only once', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-zap-empty-'));
    let time = Date.UTC(2026, 0, 1);
    const engine = await ZapFalsePositiveFilter.open(path.join(directory, 'zap.sqlite'), () => new Date(time++));
    expect((await engine.processScan('empty-target', [])).baselineEstablished).toBe(true);
    const next = await engine.processScan('empty-target', [finding()]);
    expect(next.baselineEstablished).toBe(false);
    expect(next.newFindings).toHaveLength(1);
  });

  it('filters INFO, URL, CWE, and alert rules while flag overrides ignore', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-zap-rules-'));
    const engine = await ZapFalsePositiveFilter.open(path.join(directory, 'zap.sqlite'));
    const xss = finding({ url: 'https://app.example.test/test/xss' });
    const info = finding({ alertId: '1', name: 'Debug', risk: 'INFO' });
    const result = await engine.processScan('qe', [xss, info], [
      { risk: 'INFO', action: 'ignore' },
      { cwe: '79', urlPattern: 'https://app.example.test/test/*', action: 'ignore', reason: 'intentional test XSS' },
      { alertId: '40012', action: 'flag', reason: 'review this occurrence' }
    ]);
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.reason).toBe('review this occurrence');
    expect(result.filtered[0]?.disposition).toBe('rule-ignored');
  });

  it('whitelists reviewed-safe findings and learns from Not an issue feedback', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-zap-feedback-'));
    let time = Date.UTC(2026, 0, 1);
    const engine = await ZapFalsePositiveFilter.open(path.join(directory, 'zap.sqlite'), () => new Date(time += 1000));
    await engine.processScan('prod', [finding()]);
    const safe = await engine.whitelist(finding(), 'Compensating control', 'alice');
    expect(safe.findingKey).toBe(zapFindingKey(finding()));
    const filtered = await engine.processScan('prod', [finding()]);
    expect(filtered.filtered[0]).toMatchObject({ disposition: 'whitelisted', reason: 'Compensating control (approved by alice)' });

    const another = finding({ alertId: '2', name: 'Test endpoint', url: 'https://app.example.test/test' });
    await engine.feedback(another, 'not-an-issue', 'bob', 'Dedicated security fixture');
    const after = await engine.processScan('prod', [another]);
    expect(after.filtered[0]?.disposition).toBe('whitelisted');
  });

  it('tracks true and false positive rates over time', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-zap-metrics-'));
    let time = Date.UTC(2026, 0, 1);
    const engine = await ZapFalsePositiveFilter.open(path.join(directory, 'zap.sqlite'), () => new Date(time += 1000));
    await engine.feedback(finding(), 'true-positive', 'alice');
    await engine.feedback(finding({ alertId: '2' }), 'false-positive', 'bob', 'not exploitable');
    await engine.feedback(finding({ alertId: '3' }), 'true-positive', 'carol');
    expect(engine.accuracyHistory()).toEqual([
      expect.objectContaining({ truePositives: 1, falsePositives: 0, truePositiveRate: 100, falsePositiveRate: 0 }),
      expect.objectContaining({ truePositives: 1, falsePositives: 1, truePositiveRate: 50, falsePositiveRate: 50 }),
      expect.objectContaining({ truePositives: 2, falsePositives: 1, truePositiveRate: 66.67, falsePositiveRate: 33.33 })
    ]);
  });

  it('validates findings, review input, target, and clock', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-zap-validation-'));
    const engine = await ZapFalsePositiveFilter.open(path.join(directory, 'zap.sqlite'));
    await expect(engine.processScan('', [])).rejects.toThrow('target is required');
    await expect(engine.processScan('qe', [finding({ url: 'relative' })])).rejects.toThrow('absolute URL');
    await expect(engine.processScan('qe', [finding({ risk: 'INVALID' as 'HIGH' })])).rejects.toThrow('risk is invalid');
    await expect(engine.whitelist(finding(), '', 'alice')).rejects.toThrow('reason is required');
    await expect(engine.feedback(finding(), 'not-an-issue', 'alice')).rejects.toThrow('reason is required');
    const brokenClock = await ZapFalsePositiveFilter.open(path.join(directory, 'clock.sqlite'), () => new Date('bad'));
    await expect(brokenClock.processScan('qe', [])).rejects.toThrow('Current time must be valid');
  });
});
