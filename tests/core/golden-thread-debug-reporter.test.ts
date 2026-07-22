import { generateDebugReport } from '../../src/reporters/golden-thread-debug-reporter.js';
import type { RootCauseAnalysis } from '../../src/core/golden-thread-debug.js';
import type { GoldenThreadChain } from '../../src/core/golden-thread-store.js';

const chain: GoldenThreadChain = {
  golden_thread_id: 'gt-<unsafe>',
  created_at: '2026-07-22T10:00:00Z',
  stages: [
    { id: 1, golden_thread_id: 'gt', stage: 1, status: 'PASSED', timestamp: '2026-07-22T10:00:00Z', actor: 'jira', artifact_url: 'https://example.test/?x=<script>', parent_id: null, metadata: '{}' },
    { id: 2, golden_thread_id: 'gt', stage: 2, status: 'FAILED', timestamp: '2026-07-22T10:01:00Z', actor: 'runner', artifact_url: '', parent_id: '1', metadata: '{}' }
  ]
};

const analysis: RootCauseAnalysis = {
  golden_thread_id: 'gt',
  prod_error: { message: '<script>alert(1)</script>', level: 'ERROR', first_occurrence: '2026-07-22T10:00:00Z', last_occurrence: '2026-07-22T10:01:00Z', occurrence_count: 2, affected_service: 'api&worker' },
  was_tested: true,
  test_evidence_link: 'https://example.test/evidence',
  ci_run_link: 'https://example.test/ci',
  code_change_link: 'https://example.test/commit',
  issue_history: [{ golden_thread_id: 'old', first_seen: '2026-07-01T00:00:00Z', last_seen: '2026-07-02T00:00:00Z', occurrence_count: 4, fixed_in_commit: '<abc>' }],
  classification: 'CodeBug',
  diagnostic_summary: 'Code <regression>',
  confidence: 95
};

describe('Golden Thread debug HTML report', () => {
  it('renders all evidence, stages, history, and escapes untrusted values', () => {
    const html = generateDebugReport(chain, analysis, { title: 'Incident <Report>' });
    expect(html).toContain('Incident &lt;Report&gt;');
    expect(html).toContain('gt-&lt;unsafe&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('api&amp;worker');
    expect(html).toContain('View Test Evidence');
    expect(html).toContain('View CI Run');
    expect(html).toContain('View Code Change');
    expect(html).toContain('Incident History');
    expect(html).toContain('&lt;abc&gt;');
    expect(html).toContain('FAILED');
    expect(html).toContain('PENDING');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders a dark, sparse report without optional history or links', () => {
    const sparse: RootCauseAnalysis = {
      ...analysis,
      classification: 'TestGap',
      was_tested: false,
      test_evidence_link: null,
      ci_run_link: null,
      code_change_link: null,
      issue_history: [],
      confidence: 60
    };
    const html = generateDebugReport({ ...chain, stages: [] }, sparse, { darkMode: true, includeHistory: false });
    expect(html).toContain('#1e1e1e');
    expect(html).toContain('Root Cause: TestGap');
    expect(html).toContain('No CI link available');
    expect(html).toContain('No commit link available');
    expect(html).toContain('New issue');
    expect(html).not.toContain('Incident History');
    expect(html).not.toContain('Evidence Links');
  });

  it.each(['SpecGap', 'DeploymentIssue'] as const)('uses a classification color for %s', classification => {
    expect(generateDebugReport(chain, { ...analysis, classification })).toContain(`Root Cause: ${classification}`);
  });
});
