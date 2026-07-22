/** Filters and aggregates chains for dashboard display. */
import type { GoldenThreadChain } from '../core/golden-thread-store.js';
import type { DashboardFilter, ChainSummary } from '../core/dashboard-types.js';

/**
 * Filters chains based on criteria.
 * @param chains All chains
 * @param filters Filter criteria
 * @returns Filtered chains
 */
export function filterChains(chains: GoldenThreadChain[], filters?: DashboardFilter): GoldenThreadChain[] {
  if (!filters) return chains;

  return chains.filter(chain => {
    const createdAt = new Date(chain.created_at);

    if (filters.dateStart && createdAt < filters.dateStart) {
      return false;
    }

    if (filters.dateEnd && createdAt > filters.dateEnd) {
      return false;
    }

    const metadata = extractMetadata(chain);

    if (filters.environment && metadata.environment !== filters.environment) {
      return false;
    }

    if (filters.team && metadata.team !== filters.team) {
      return false;
    }

    if (filters.project && metadata.project !== filters.project) {
      return false;
    }

    return true;
  });
}

/**
 * Enriches a chain with calculated durations per stage.
 * @param chain The chain to enrich
 * @returns Chain with duration fields added
 */
export function enrichChainWithDuration(chain: GoldenThreadChain): GoldenThreadChain & { stageDurations: Map<number, number>; totalDuration: number } {
  const stageDurations = new Map<number, number>();
  const sorted = [...chain.stages].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 0; i < sorted.length - 1; i++) {
    const startTime = new Date(sorted[i].timestamp).getTime();
    const endTime = new Date(sorted[i + 1].timestamp).getTime();
    const duration = Math.max(0, endTime - startTime);
    stageDurations.set(sorted[i].stage, duration);
  }

  if (sorted.length > 0) {
    stageDurations.set(sorted[sorted.length - 1].stage, 0);
  }

  const totalDuration = sorted.length >= 2
    ? new Date(sorted[sorted.length - 1].timestamp).getTime() -
      new Date(sorted[0].timestamp).getTime()
    : 0;

  return {
    ...chain,
    stageDurations,
    totalDuration: Math.max(0, totalDuration)
  };
}

/**
 * Converts a chain to a dashboard summary.
 * @param chain The chain
 * @returns Minimal summary for UI
 */
export function toChainSummary(chain: GoldenThreadChain): ChainSummary {
  const enriched = enrichChainWithDuration(chain);
  const metadata = extractMetadata(chain);
  const hasFailed = chain.stages.some(s => s.status === 'FAILED');
  const hasPending = chain.stages.some(s => s.status === 'PENDING' || s.status === 'IN_PROGRESS');

  const status = hasFailed ? 'FAIL' : hasPending ? 'PENDING' : 'PASS';

  return {
    id: chain.golden_thread_id,
    status,
    duration: enriched.totalDuration,
    environment: metadata.environment,
    timestamp: chain.created_at,
    stages: chain.stages.map(stage => ({
      stage: stage.stage,
      status: stage.status,
      duration: enriched.stageDurations.get(stage.stage) || 0
    }))
  };
}

interface ExtractedMetadata {
  environment?: string;
  team?: string;
  project?: string;
}

function extractMetadata(chain: GoldenThreadChain): ExtractedMetadata {
  const result: ExtractedMetadata = {};

  for (const stage of chain.stages) {
    try {
      const meta = JSON.parse(stage.metadata);
      if (!result.environment && meta.environment) result.environment = meta.environment;
      if (!result.team && meta.team) result.team = meta.team;
      if (!result.project && meta.project) result.project = meta.project;

      if (result.environment && result.team && result.project) break;
    } catch {
      // ignore parse errors
    }
  }

  return result;
}
