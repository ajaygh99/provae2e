/** Provider-neutral AI usage accounting and hard budget enforcement. */
export interface AiUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  reason: string;
  local: boolean;
}

export interface AiBudget {
  maxCloudCallsPerRun: number;
  maxCostUsdPerRun: number;
  maxInputTokensPerCall: number;
  maxOutputTokensPerCall: number;
}

export const DEFAULT_AI_BUDGET: AiBudget = {
  maxCloudCallsPerRun: 1,
  maxCostUsdPerRun: 1,
  maxInputTokensPerCall: 4_000,
  maxOutputTokensPerCall: 1_000
};

/** In-memory guard used by a single CLI/CI run; callers persist the summary as evidence. */
export class AiBudgetGuard {
  private readonly usage: AiUsage[] = [];

  constructor(private readonly budget: AiBudget = DEFAULT_AI_BUDGET) {}

  /** Checks whether a proposed model call fits within configured hard limits. */
  canCall(inputTokens: number, outputTokens: number, estimatedCostUsd: number, local: boolean): boolean {
    if (inputTokens < 0 || outputTokens < 0 || estimatedCostUsd < 0) return false;
    if (inputTokens > this.budget.maxInputTokensPerCall || outputTokens > this.budget.maxOutputTokensPerCall) return false;
    if (local) return true;
    const cloud = this.usage.filter(item => !item.local);
    const spent = cloud.reduce((total, item) => total + item.estimatedCostUsd, 0);
    return cloud.length < this.budget.maxCloudCallsPerRun
      && spent + estimatedCostUsd <= this.budget.maxCostUsdPerRun;
  }

  /** Records completed usage; rejects records that would exceed the budget. */
  record(entry: AiUsage): void {
    if (!this.canCall(entry.inputTokens, entry.outputTokens, entry.estimatedCostUsd, entry.local)) {
      throw new Error('AI budget exceeded');
    }
    if (!entry.provider.trim() || !entry.model.trim() || !entry.reason.trim()) {
      throw new Error('AI usage requires provider, model, and reason');
    }
    this.usage.push({ ...entry });
  }

  /** Returns an auditable, secret-free usage summary for the run. */
  summary(): { calls: number; cloudCalls: number; estimatedCostUsd: number; usage: AiUsage[] } {
    return {
      calls: this.usage.length,
      cloudCalls: this.usage.filter(item => !item.local).length,
      estimatedCostUsd: this.usage.reduce((total, item) => total + item.estimatedCostUsd, 0),
      usage: this.usage.map(item => ({ ...item }))
    };
  }
}
