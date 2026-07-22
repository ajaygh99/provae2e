/** Tests for dashboard metrics calculation. */
import type { GoldenThreadChain } from '../../src/core/golden-thread-store';
import {
  calculateStageDurations,
  calculateStagePassRate,
  getCommonFailureStages,
  getMetricsSummary
} from '../../src/reporters/dashboard-metrics';

describe('Dashboard Metrics', () => {
  const now = new Date().toISOString();
  const thenMs = new Date(now).getTime();

  function createChain(stages: Array<{ stage: 1 | 2 | 3 | 4 | 5 | 6 | 7; status: 'PASSED' | 'FAILED' | 'PENDING' | 'IN_PROGRESS' }>): GoldenThreadChain {
    return {
      golden_thread_id: 'test-chain-' + Math.random().toString(36).substring(7),
      created_at: now,
      stages: stages.map((s, idx) => ({
        id: idx,
        golden_thread_id: 'test-chain',
        stage: s.stage,
        status: s.status,
        timestamp: new Date(thenMs + idx * 30000).toISOString(),
        actor: 'test',
        artifact_url: 'http://example.com/artifact',
        parent_id: idx > 0 ? String(idx - 1) : null,
        metadata: '{}'
      }))
    };
  }

  describe('calculateStageDurations', () => {
    it('calculates duration between consecutive stages', () => {
      const chain = createChain([
        { stage: 1, status: 'PASSED' },
        { stage: 2, status: 'PASSED' }
      ]);

      const durations = calculateStageDurations([chain]);

      expect(durations.size).toBe(7);
      expect(durations.get(1)).toBeDefined();
      expect(durations.get(1)![0]).toBeGreaterThan(0);
    });

    it('handles empty chain list', () => {
      const durations = calculateStageDurations([]);

      expect(durations.size).toBe(7);
      for (let i = 1; i <= 7; i++) {
        expect(durations.get(i as unknown as 1 | 2 | 3 | 4 | 5 | 6 | 7)).toEqual([]);
      }
    });

    it('handles chains with missing stages', () => {
      const chain = createChain([
        { stage: 1, status: 'PASSED' },
        { stage: 3, status: 'PASSED' }
      ]);

      const durations = calculateStageDurations([chain]);

      expect(durations.get(1)!.length).toBe(1);
      expect(durations.get(2)!.length).toBe(0);
    });
  });

  describe('calculateStagePassRate', () => {
    it('calculates pass rate for each stage', () => {
      const chain1 = createChain([
        { stage: 1, status: 'PASSED' },
        { stage: 2, status: 'PASSED' }
      ]);
      const chain2 = createChain([
        { stage: 1, status: 'FAILED' },
        { stage: 2, status: 'PASSED' }
      ]);

      const rates = calculateStagePassRate([chain1, chain2]);

      expect(rates.get(1)).toBe(50);
      expect(rates.get(2)).toBe(100);
    });

    it('returns 0 for stages with no completed runs', () => {
      const chain = createChain([{ stage: 1, status: 'PENDING' }]);

      const rates = calculateStagePassRate([chain]);

      expect(rates.get(1)).toBe(0);
    });
  });

  describe('getCommonFailureStages', () => {
    it('identifies stages with the most failures', () => {
      const chains = [
        createChain([
          { stage: 1, status: 'FAILED' },
          { stage: 2, status: 'FAILED' }
        ]),
        createChain([
          { stage: 1, status: 'FAILED' },
          { stage: 3, status: 'FAILED' }
        ])
      ];

      const failures = getCommonFailureStages(chains);

      expect(failures[0].stage).toBe(1);
      expect(failures[0].count).toBe(2);
    });

    it('handles no failures', () => {
      const chain = createChain([
        { stage: 1, status: 'PASSED' },
        { stage: 2, status: 'PASSED' }
      ]);

      const failures = getCommonFailureStages([chain]);

      expect(failures.every(f => f.count === 0)).toBe(true);
    });
  });

  describe('getMetricsSummary', () => {
    it('computes complete metrics summary', () => {
      const chain = createChain([
        { stage: 1, status: 'PASSED' },
        { stage: 2, status: 'PASSED' },
        { stage: 3, status: 'PASSED' }
      ]);

      const summary = getMetricsSummary([chain]);

      expect(summary.totalChains).toBe(1);
      expect(summary.overallPassRate).toBeGreaterThan(0);
      expect(summary.avgChainDuration).toBeGreaterThan(0);
      expect(summary.stagePassRates.get(1)).toBe(100);
    });

    it('handles empty chain list', () => {
      const summary = getMetricsSummary([]);

      expect(summary.totalChains).toBe(0);
      expect(summary.overallPassRate).toBe(0);
      expect(summary.avgChainDuration).toBe(0);
    });

    it('calculates pass rate correctly with failed stages', () => {
      const chain = createChain([
        { stage: 1, status: 'PASSED' },
        { stage: 2, status: 'FAILED' },
        { stage: 3, status: 'PASSED' }
      ]);

      const summary = getMetricsSummary([chain]);

      expect(summary.overallPassRate).toBeLessThan(100);
    });
  });
});
