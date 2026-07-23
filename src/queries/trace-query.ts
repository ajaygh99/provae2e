/**
 * Golden Thread query engine — fetch chains by issue-key, commit, test-id
 */
import { GoldenThreadStore, type GoldenThreadChain, STAGE_NAMES } from '../core/golden-thread-store.js';

export interface TraceQueryResult {
  chains: GoldenThreadChain[];
  totalCount: number;
  errors: string[];
}

export interface SLAThreshold {
  maxStageDurationMs: number;
  maxTotalDurationMs: number;
  deploymentStatus: 'GREEN' | 'YELLOW' | 'RED';
}

/**
 * Query Golden Thread chains by various criteria.
 */
export class TraceQueryEngine {
  constructor(private store: GoldenThreadStore) {}

  /**
   * Find chain by issue key (searches metadata.issue_key).
   */
  async queryByIssueKey(issueKey: string): Promise<TraceQueryResult> {
    const allChainIds = await this.store.listChains();
    const chains: GoldenThreadChain[] = [];
    const errors: string[] = [];

    for (const chainId of allChainIds) {
      const chain = await this.store.getChain(chainId);
      if (!chain) continue;

      // Check if any stage has matching issue_key in metadata
      const found = chain.stages.some(stage => {
        try {
          const meta = JSON.parse(stage.metadata);
          return meta.issue_key === issueKey;
        } catch {
          return false;
        }
      });

      if (found) chains.push(chain);
    }

    if (chains.length === 0) {
      errors.push(`No chains found for issue key: ${issueKey}`);
    }

    return { chains, totalCount: chains.length, errors };
  }

  /**
   * Find chain by commit SHA (searches metadata.commit or artifact_url).
   */
  async queryByCommit(sha: string): Promise<TraceQueryResult> {
    const allChainIds = await this.store.listChains();
    const chains: GoldenThreadChain[] = [];
    const errors: string[] = [];

    for (const chainId of allChainIds) {
      const chain = await this.store.getChain(chainId);
      if (!chain) continue;

      const found = chain.stages.some(stage => {
        // Check metadata.commit
        try {
          const meta = JSON.parse(stage.metadata);
          if (meta.commit === sha) return true;
        } catch {
          // ignore parse errors
        }
        // Check artifact_url contains SHA
        return stage.artifact_url.includes(sha);
      });

      if (found) chains.push(chain);
    }

    if (chains.length === 0) {
      errors.push(`No chains found for commit: ${sha}`);
    }

    return { chains, totalCount: chains.length, errors };
  }

  /**
   * Find chain by test execution ID (searches metadata.test_id).
   */
  async queryByTestId(testId: string): Promise<TraceQueryResult> {
    const allChainIds = await this.store.listChains();
    const chains: GoldenThreadChain[] = [];
    const errors: string[] = [];

    for (const chainId of allChainIds) {
      const chain = await this.store.getChain(chainId);
      if (!chain) continue;

      const found = chain.stages.some(stage => {
        try {
          const meta = JSON.parse(stage.metadata);
          return meta.test_id === testId;
        } catch {
          return false;
        }
      });

      if (found) chains.push(chain);
    }

    if (chains.length === 0) {
      errors.push(`No chains found for test ID: ${testId}`);
    }

    return { chains, totalCount: chains.length, errors };
  }

  /**
   * List all chains created within date range.
   */
  async queryByDateRange(fromDate: string, toDate: string): Promise<TraceQueryResult> {
    const allChainIds = await this.store.listChains();
    const chains: GoldenThreadChain[] = [];
    const errors: string[] = [];

    const fromTime = new Date(fromDate).getTime();
    const toTime = new Date(toDate).getTime();

    if (isNaN(fromTime) || isNaN(toTime)) {
      errors.push(`Invalid date format. Use YYYY-MM-DD`);
      return { chains, totalCount: 0, errors };
    }

    for (const chainId of allChainIds) {
      const chain = await this.store.getChain(chainId);
      if (!chain) continue;

      const chainTime = new Date(chain.created_at).getTime();
      if (chainTime >= fromTime && chainTime <= toTime) {
        chains.push(chain);
      }
    }

    return { chains, totalCount: chains.length, errors };
  }

  /**
   * Format chain as human-readable text table.
   */
  formatAsTable(chain: GoldenThreadChain): string {
    let output = `\n🔗 Golden Thread: ${chain.golden_thread_id}\n`;
    output += `   Created: ${chain.created_at}\n\n`;
    output += '┌─ STAGE ─┬─ STATUS ──────┬─ ACTOR ───────┬─ TIMESTAMP ──────────────┐\n';

    for (const stage of chain.stages) {
      const stageName = STAGE_NAMES[stage.stage];
      const status = stage.status;
      output += `│ ${String(stage.stage)} ${stageName.padEnd(4)} │ ${status.padEnd(13)} │ ${(stage.actor || '—').padEnd(13)} │ ${stage.timestamp.slice(0, 23)} │\n`;
    }

    output += '└────────┴───────────────┴───────────────┴──────────────────────────┘\n';
    return output;
  }

  /**
   * Validate chain against SLA thresholds.
   */
  validateSLA(chain: GoldenThreadChain, thresholds: SLAThreshold): { valid: boolean; breaches: string[] } {
    const breaches: string[] = [];

    if (chain.stages.length === 0) {
      breaches.push('Empty chain (no stages)');
      return { valid: false, breaches };
    }

    // Check individual stage durations
    for (let i = 0; i < chain.stages.length - 1; i++) {
      const current = chain.stages[i];
      const next = chain.stages[i + 1];
      const duration = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();

      if (duration > thresholds.maxStageDurationMs) {
        breaches.push(
          `Stage ${current.stage}→${next.stage} took ${duration}ms (threshold: ${thresholds.maxStageDurationMs}ms)`
        );
      }
    }

    // Check total chain duration
    const firstStage = chain.stages[0];
    const lastStage = chain.stages[chain.stages.length - 1];
    const totalDuration = new Date(lastStage.timestamp).getTime() - new Date(firstStage.timestamp).getTime();

    if (totalDuration > thresholds.maxTotalDurationMs) {
      breaches.push(
        `Total chain duration ${totalDuration}ms (threshold: ${thresholds.maxTotalDurationMs}ms)`
      );
    }

    // Check deployment status
    const deploymentIssues = chain.stages.filter(s => s.deployment_status === 'RED');
    if (deploymentIssues.length > 0) {
      breaches.push(`Deployment RED status detected in ${deploymentIssues.length} stage(s)`);
    }

    return { valid: breaches.length === 0, breaches };
  }

  /**
   * Export chain as JSON.
   * @param chain The Golden Thread chain to export
   * @returns JSON representation of the chain
   */
  exportAsJson(chain: GoldenThreadChain): Record<string, unknown> {
    return {
      golden_thread_id: chain.golden_thread_id,
      created_at: chain.created_at,
      stages: chain.stages.map(s => ({
        stage: s.stage,
        stage_name: STAGE_NAMES[s.stage],
        status: s.status,
        timestamp: s.timestamp,
        actor: s.actor,
        artifact_url: s.artifact_url,
        deployment_status: s.deployment_status || null,
        metadata: ((): Record<string, unknown> => {
          try {
            return JSON.parse(s.metadata);
          } catch {
            return { raw: s.metadata };
          }
        })()
      }))
    };
  }
}
