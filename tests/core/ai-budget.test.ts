import { AiBudgetGuard } from '../../src/core/ai-budget';

describe('AiBudgetGuard', () => {
  it('allows unlimited local calls within per-call token limits', () => {
    const guard = new AiBudgetGuard({ maxCloudCallsPerRun: 1, maxCostUsdPerRun: 0.5, maxInputTokensPerCall: 100, maxOutputTokensPerCall: 50 });
    for (let index = 0; index < 3; index++) {
      guard.record({ provider: 'ollama', model: 'qwen', inputTokens: 50, outputTokens: 20, estimatedCostUsd: 0, reason: 'failure classification', local: true });
    }
    expect(guard.summary()).toMatchObject({ calls: 3, cloudCalls: 0, estimatedCostUsd: 0 });
  });

  it('limits paid cloud escalation to the configured count', () => {
    const guard = new AiBudgetGuard({ maxCloudCallsPerRun: 1, maxCostUsdPerRun: 1, maxInputTokensPerCall: 100, maxOutputTokensPerCall: 50 });
    guard.record({ provider: 'anthropic', model: 'reviewer', inputTokens: 50, outputTokens: 20, estimatedCostUsd: 0.1, reason: 'unresolved failure', local: false });
    expect(() => guard.record({ provider: 'anthropic', model: 'reviewer', inputTokens: 50, outputTokens: 20, estimatedCostUsd: 0.1, reason: 'duplicate escalation', local: false })).toThrow('AI budget exceeded');
  });

  it('rejects calls that exceed token or cost budgets', () => {
    const guard = new AiBudgetGuard({ maxCloudCallsPerRun: 1, maxCostUsdPerRun: 0.05, maxInputTokensPerCall: 100, maxOutputTokensPerCall: 50 });
    expect(guard.canCall(101, 10, 0, true)).toBe(false);
    expect(guard.canCall(50, 20, 0.1, false)).toBe(false);
  });
});
