/** Tests for dashboard aggregator. */
import type { GoldenThreadChain } from '../../src/core/golden-thread-store';
import { filterChains, enrichChainWithDuration, toChainSummary } from '../../src/reporters/dashboard-aggregator';

describe('Dashboard Aggregator', () => {
  const now = new Date().toISOString();
  const thenMs = new Date(now).getTime();

  function createChain(overrides?: {
    timestamp?: string;
    metadata?: Record<string, unknown>;
    stages?: Array<{ stage: 1 | 2 | 3 | 4 | 5 | 6 | 7; status: 'PASSED' | 'FAILED' | 'PENDING' | 'IN_PROGRESS' }>;
  }): GoldenThreadChain {
    const timestamp = overrides?.timestamp ?? now;
    const baseMetadata = overrides?.metadata ?? {};

    const stages = overrides?.stages ?? [
      { stage: 1 as const, status: 'PASSED' as const },
      { stage: 2 as const, status: 'PASSED' as const }
    ];

    return {
      golden_thread_id: 'chain-' + Math.random().toString(36).substring(7),
      created_at: timestamp,
      stages: stages.map((s, idx) => ({
        id: idx,
        golden_thread_id: 'test-chain',
        stage: s.stage,
        status: s.status,
        timestamp: new Date(thenMs + idx * 10000).toISOString(),
        actor: 'test',
        artifact_url: 'http://example.com/artifact',
        parent_id: idx > 0 ? String(idx - 1) : null,
        metadata: JSON.stringify(baseMetadata)
      }))
    };
  }

  describe('filterChains', () => {
    it('returns all chains when no filters applied', () => {
      const chains = [createChain(), createChain()];

      const filtered = filterChains(chains);

      expect(filtered).toHaveLength(2);
    });

    it('filters by date range', () => {
      const yesterday = new Date(thenMs - 86400000).toISOString();
      const dayAfterTomorrow = new Date(thenMs + 172800000).toISOString();

      const chains = [
        createChain({ timestamp: yesterday }),
        createChain({ timestamp: now }),
        createChain({ timestamp: dayAfterTomorrow })
      ];

      const filtered = filterChains(chains, {
        dateStart: new Date(thenMs),
        dateEnd: new Date(thenMs + 86400000)
      });

      expect(filtered).toHaveLength(1);
    });

    it('filters by environment', () => {
      const chains = [
        createChain({ metadata: { environment: 'prod' } }),
        createChain({ metadata: { environment: 'staging' } }),
        createChain({ metadata: { environment: 'prod' } })
      ];

      const filtered = filterChains(chains, { environment: 'prod' });

      expect(filtered).toHaveLength(2);
    });

    it('filters by team', () => {
      const chains = [
        createChain({ metadata: { team: 'TeamA' } }),
        createChain({ metadata: { team: 'TeamB' } })
      ];

      const filtered = filterChains(chains, { team: 'TeamA' });

      expect(filtered).toHaveLength(1);
    });

    it('filters by project', () => {
      const chains = [
        createChain({ metadata: { project: 'ProjectX' } }),
        createChain({ metadata: { project: 'ProjectY' } })
      ];

      const filtered = filterChains(chains, { project: 'ProjectX' });

      expect(filtered).toHaveLength(1);
    });

    it('applies multiple filters together', () => {
      const chains = [
        createChain({
          timestamp: now,
          metadata: { environment: 'prod', team: 'TeamA', project: 'ProjectX' }
        }),
        createChain({
          timestamp: now,
          metadata: { environment: 'staging', team: 'TeamA', project: 'ProjectX' }
        })
      ];

      const filtered = filterChains(chains, {
        environment: 'prod',
        team: 'TeamA',
        project: 'ProjectX'
      });

      expect(filtered).toHaveLength(1);
    });

    it('returns empty when no chains match filters', () => {
      const chains = [createChain({ metadata: { environment: 'prod' } })];

      const filtered = filterChains(chains, { environment: 'staging' });

      expect(filtered).toHaveLength(0);
    });
  });

  describe('enrichChainWithDuration', () => {
    it('calculates duration between stages', () => {
      const chain = createChain();

      const enriched = enrichChainWithDuration(chain);

      expect(enriched.stageDurations).toBeDefined();
      expect(enriched.stageDurations.size).toBeGreaterThan(0);
      expect(enriched.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('handles single-stage chain', () => {
      const chain = createChain({ stages: [{ stage: 1, status: 'PASSED' }] });

      const enriched = enrichChainWithDuration(chain);

      expect(enriched.totalDuration).toBe(0);
    });

    it('preserves original chain data', () => {
      const chain = createChain();
      const originalId = chain.golden_thread_id;

      const enriched = enrichChainWithDuration(chain);

      expect(enriched.golden_thread_id).toBe(originalId);
      expect(enriched.stages).toHaveLength(chain.stages.length);
    });
  });

  describe('toChainSummary', () => {
    it('converts chain to summary', () => {
      const chain = createChain();

      const summary = toChainSummary(chain);

      expect(summary.id).toBe(chain.golden_thread_id);
      expect(summary.status).toBeDefined();
      expect(summary.duration).toBeGreaterThanOrEqual(0);
      expect(summary.stages).toHaveLength(chain.stages.length);
    });

    it('sets status to PASS for all-passed stages', () => {
      const chain = createChain({
        stages: [
          { stage: 1, status: 'PASSED' },
          { stage: 2, status: 'PASSED' }
        ]
      });

      const summary = toChainSummary(chain);

      expect(summary.status).toBe('PASS');
    });

    it('sets status to FAIL when any stage failed', () => {
      const chain = createChain({
        stages: [
          { stage: 1, status: 'PASSED' },
          { stage: 2, status: 'FAILED' }
        ]
      });

      const summary = toChainSummary(chain);

      expect(summary.status).toBe('FAIL');
    });

    it('sets status to PENDING when no stages completed', () => {
      const chain = createChain({
        stages: [
          { stage: 1, status: 'PENDING' },
          { stage: 2, status: 'IN_PROGRESS' }
        ]
      });

      const summary = toChainSummary(chain);

      expect(summary.status).toBe('PENDING');
    });

    it('extracts environment metadata', () => {
      const chain = createChain({
        metadata: { environment: 'prod', team: 'TeamA' }
      });

      const summary = toChainSummary(chain);

      expect(summary.environment).toBe('prod');
    });
  });
});
