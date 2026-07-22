/** Tests for dashboard PDF export. */
import type { GoldenThreadChain } from '../../src/core/golden-thread-store';
import { generatePdfReportHtml } from '../../src/reporters/dashboard-pdf-export';

describe('Dashboard PDF Export', () => {
  const now = new Date().toISOString();
  const thenMs = new Date(now).getTime();

  function createChain(stageCount: number = 3): GoldenThreadChain {
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
        status: 'PASSED' as const,
        timestamp: new Date(thenMs + i * 10000).toISOString(),
        actor: `actor-${i}`,
        artifact_url: `http://example.com/artifact${i}`,
        parent_id: i > 1 ? String(i - 2) : null,
        metadata: JSON.stringify({ environment: 'prod', team: 'TeamA', project: 'ProjectX' })
      });
    }

    return {
      golden_thread_id: 'chain-' + Math.random().toString(36).substring(7),
      created_at: now,
      stages
    };
  }

  describe('generatePdfReportHtml', () => {
    it('generates HTML string', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain);

      expect(html).toBeDefined();
      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('includes document structure for PDF', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      expect(html).toContain('</html>');
    });

    it('includes cover page', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('cover-page');
      expect(html).toContain('Golden Thread Traceability Report');
    });

    it('includes chain ID and metadata', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain);

      expect(html).toContain(chain.golden_thread_id);
      expect(html).toContain('Chain ID');
      expect(html).toContain('Created');
    });

    it('includes all stages in report', () => {
      const chain = createChain(7);

      const html = generatePdfReportHtml(chain);

      for (let i = 1; i <= 7; i++) {
        expect(html).toContain(`Stage ${i}`);
      }
    });

    it('includes stage details (status, actor, timestamp)', () => {
      const chain = createChain(3);

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('Status');
      expect(html).toContain('Actor');
      expect(html).toContain('Timestamp');
      expect(html).toContain('actor-1');
    });

    it('includes artifact links', () => {
      const chain = createChain(2);

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('Artifact URL');
      expect(html).toContain('http://example.com/artifact1');
    });

    it('includes metadata when available', () => {
      const chain = createChain(2);

      const html = generatePdfReportHtml(chain, { includeMetadata: true });

      expect(html).toContain('Metadata');
      expect(html).toContain('environment');
    });

    it('excludes metadata when disabled', () => {
      const chain = createChain(2);

      const html = generatePdfReportHtml(chain, { includeMetadata: false });

      // Should not have metadata section for stages
      const metadataCount = (html.match(/Metadata:/g) || []).length;
      expect(metadataCount).toBe(0);
    });

    it('renders custom title', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain, { title: 'Custom Report Title' });

      expect(html).toContain('Custom Report Title');
    });

    it('escapes HTML special characters', () => {
      const chain: GoldenThreadChain = {
        golden_thread_id: 'chain-<test>',
        created_at: now,
        stages: [
          {
            id: 0,
            golden_thread_id: 'test',
            stage: 1 as const,
            status: 'PASSED' as const,
            timestamp: now,
            actor: 'test&actor',
            artifact_url: 'http://example.com/artifact?x=1&y=2',
            parent_id: null,
            metadata: '{"key": "value with <html>"}'
          }
        ]
      };

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });

    it('includes page breaks for PDF printing', () => {
      const chain = createChain(3);

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('page-break');
    });

    it('includes executive summary section', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('Executive Summary');
    });

    it('includes verification section', () => {
      const chain = createChain();

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('Verification');
    });

    it('handles chains with pending stages', () => {
      const chain: GoldenThreadChain = {
        golden_thread_id: 'test-chain',
        created_at: now,
        stages: [
          {
            id: 0,
            golden_thread_id: 'test',
            stage: 1 as const,
            status: 'PASSED' as const,
            timestamp: now,
            actor: 'test',
            artifact_url: 'http://example.com',
            parent_id: null,
            metadata: '{}'
          },
          {
            id: 1,
            golden_thread_id: 'test',
            stage: 2 as const,
            status: 'PENDING' as const,
            timestamp: now,
            actor: 'test',
            artifact_url: 'http://example.com',
            parent_id: '0',
            metadata: '{}'
          }
        ]
      };

      const html = generatePdfReportHtml(chain);

      expect(html).toContain('PENDING');
    });
  });
});
