/** Metrics calculation for Golden Thread dashboard. */
import type { GoldenThreadChain, Stage } from '../core/golden-thread-store.js';
import type { DashboardMetrics, StageFailure } from '../core/dashboard-types.js';

/**
 * Calculates duration per stage across all chains.
 * @param chains Collection of chains to analyze
 * @returns Map of stage to array of durations in milliseconds
 */
export function calculateStageDurations(chains: GoldenThreadChain[]): Map<Stage, number[]> {
  const stageDurations = new Map<Stage, number[]>();

  for (let i = 1; i <= 7; i++) {
    stageDurations.set(i as Stage, []);
  }

  for (const chain of chains) {
    const sorted = [...chain.stages].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (let i = 0; i < sorted.length - 1; i++) {
      const currentStage = sorted[i].stage;
      const duration = new Date(sorted[i + 1].timestamp).getTime() -
                       new Date(sorted[i].timestamp).getTime();

      stageDurations.get(currentStage)!.push(Math.max(0, duration));
    }
  }

  return stageDurations;
}

/**
 * Calculates pass rate per stage.
 * @param chains Collection of chains to analyze
 * @returns Map of stage to pass rate (0-100)
 */
export function calculateStagePassRate(chains: GoldenThreadChain[]): Map<Stage, number> {
  const passRates = new Map<Stage, number>();

  for (let i = 1; i <= 7; i++) {
    const stage = i as Stage;
    const stageLogs = chains
      .flatMap(c => c.stages.filter(s => s.stage === stage))
      .filter(s => s.status === 'PASSED' || s.status === 'FAILED');

    if (stageLogs.length === 0) {
      passRates.set(stage, 0);
    } else {
      const passCount = stageLogs.filter(s => s.status === 'PASSED').length;
      passRates.set(stage, (passCount / stageLogs.length) * 100);
    }
  }

  return passRates;
}

/**
 * Identifies stages with the most failures.
 * @param chains Collection of chains to analyze
 * @returns Stages sorted by failure count, descending
 */
export function getCommonFailureStages(chains: GoldenThreadChain[]): StageFailure[] {
  const failureCounts = new Map<Stage, number>();
  let totalFailed = 0;

  for (let i = 1; i <= 7; i++) {
    const stage = i as Stage;
    const failCount = chains
      .flatMap(c => c.stages.filter(s => s.stage === stage && s.status === 'FAILED'))
      .length;
    failureCounts.set(stage, failCount);
    totalFailed += failCount;
  }

  const failures: StageFailure[] = [];
  for (const [stage, count] of failureCounts.entries()) {
    failures.push({
      stage,
      count,
      percentage: totalFailed === 0 ? 0 : (count / totalFailed) * 100
    });
  }

  return failures.sort((a, b) => b.count - a.count);
}

/**
 * Computes overall metrics summary from chains.
 * @param chains Collection of chains
 * @returns Complete metrics object
 */
export function getMetricsSummary(chains: GoldenThreadChain[]): DashboardMetrics {
  const stageDurations = calculateStageDurations(chains);
  const stagePassRates = calculateStagePassRate(chains);
  const commonFailures = getCommonFailureStages(chains);

  const avgChainDuration = calculateAverageChainDuration(chains);
  const overallPassRate = calculateOverallPassRate(chains);

  const stageDurationsMap = new Map<Stage, number>();
  for (const [stage, durations] of stageDurations.entries()) {
    const avg = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    stageDurationsMap.set(stage, avg);
  }

  return {
    totalChains: chains.length,
    overallPassRate,
    avgChainDuration,
    stagePassRates,
    stageDurations: stageDurationsMap,
    commonFailures
  };
}

function calculateAverageChainDuration(chains: GoldenThreadChain[]): number {
  if (chains.length === 0) return 0;

  const durations = chains.map(chain => {
    if (chain.stages.length < 2) return 0;
    const sorted = [...chain.stages].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return new Date(sorted[sorted.length - 1].timestamp).getTime() -
           new Date(sorted[0].timestamp).getTime();
  });

  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

function calculateOverallPassRate(chains: GoldenThreadChain[]): number {
  if (chains.length === 0) return 0;

  const completedChains = chains.filter(c =>
    c.stages.some(s => s.status === 'PASSED' || s.status === 'FAILED')
  );

  if (completedChains.length === 0) return 0;

  const passedChains = completedChains.filter(c =>
    c.stages.every(s => s.status === 'PASSED' || s.status === 'PENDING' || s.status === 'IN_PROGRESS')
  );

  return (passedChains.length / completedChains.length) * 100;
}
