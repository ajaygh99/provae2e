/** Tests for dashboard HTML generator. */
import type { GoldenThreadChain } from '../../src/core/golden-thread-store';
import { generateDashboardHtml } from '../../src/reporters/dashboard-generator';
import { getMetricsSummary } from '../../src/reporters/dashboard-metrics';

describe('Dashboard Generator', () => {
  const now = new Date().toISOString();
  const thenMs = new Date(now).getTime();

  function createChain(stageCount: number = 3, withFailure: boolean = false): GoldenThreadChain {
    const stages: Array<{
      id: number;
      golden_thread_id: string;
      stage: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      status: 'PASSED' | 'FAILED' | 'PENDING' | 'IN_PROGRESS';
      timestamp: string;
      actor: string;
      artifact_url: string;
      parent_id: string | null;
      metadata: string;
    }> = [];
    for (let i = 1; i <= stageCount && i <= 7; i++) {
      stages.push({
        id: i - 1,
        golden_thread_id: 'test-chain',
        stage: i as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        status: (withFailure && i === 2 ? 'FAILED' : 'PASSED') as 'PASSED' | 'FAILED',
        timestamp: new Date(thenMs + i * 10000).toISOString(),
        actor: 'test-actor',
        artifact_url: `http://example.com/artifact${i}`,
        parent_id: i > 1 ? String(i - 2) : null,
        metadata: JSON.stringify({ environment: 'prod', team: 'TeamA' })
      });
    }

    return {
      golden_thread_id: 'chain-' + Math.random().toString(36).substring(7),
      created_at: now,
      stages
    };
  }

  describe('generateDashboardHtml', () => {
    it('generates HTML string', () => {
      const chains = [createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toBeDefined();
      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Golden Thread');
    });

    it('includes metrics in dashboard', () => {
      const chains = [createChain(), createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toContain('Total Chains');
      expect(html).toContain('Pass Rate');
      expect(html).toContain('Avg Chain Duration');
      expect(html).toContain('2');
    });

    it('renders all 7 stages for each chain', () => {
      const chains = [createChain(7)];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      for (let i = 1; i <= 7; i++) {
        expect(html).toContain(`Stage ${i}`);
      }
    });

    it('includes stage indicators with correct colors', () => {
      const chains = [createChain(3, true)];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toContain('passed');
      expect(html).toContain('failed');
      expect(html).toContain('stage-indicator');
    });

    it('includes modal structure for drill-down', () => {
      const chains = [createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toContain('modal');
      expect(html).toContain('openModal');
      expect(html).toContain('closeModal');
    });

    it('includes interactive JavaScript', () => {
      const chains = [createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toContain('<script>');
      expect(html).toContain('function openModal');
      expect(html).toContain('function closeModal');
    });

    it('renders custom title', () => {
      const chains = [createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics, { title: 'Custom Title' });

      expect(html).toContain('Custom Title');
    });

    it('applies dark mode when enabled', () => {
      const chains = [createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics, { darkMode: true });

      expect(html).toContain('#1a1a1a');
    });

    it('uses light mode by default', () => {
      const chains = [createChain()];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics, { darkMode: false });

      expect(html).toContain('#f5f5f5');
    });

    it('escapes HTML special characters in artifact URLs', () => {
      const chain: GoldenThreadChain = {
        golden_thread_id: 'test',
        created_at: now,
        stages: [
          {
            id: 0,
            golden_thread_id: 'test',
            stage: 1 as const,
            status: 'PASSED' as const,
            timestamp: now,
            actor: 'test',
            artifact_url: 'http://example.com/artifact?x=1&y=2',
            parent_id: null,
            metadata: '{}'
          }
        ]
      };
      const metrics = getMetricsSummary([chain]);

      const html = generateDashboardHtml([chain], metrics);

      expect(html).toContain('&amp;');
    });

    it('handles empty chain list gracefully', () => {
      const chains: GoldenThreadChain[] = [];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toContain('Golden Thread');
      expect(html).toContain('0');
    });

    it('displays chain duration', () => {
      const chains = [createChain(3)];
      const metrics = getMetricsSummary(chains);

      const html = generateDashboardHtml(chains, metrics);

      expect(html).toContain('Duration');
    });
  });
});
