import axios from 'axios';
import { escalateToBugTicket } from '../../src/core/golden-thread-debug-jira.js';
import type { RootCauseAnalysis } from '../../src/core/golden-thread-debug.js';
import type { GoldenThreadChain } from '../../src/core/golden-thread-store.js';
import type { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const chain: GoldenThreadChain = {
  golden_thread_id: 'gt-1',
  created_at: '2026-07-22T10:00:00Z',
  stages: [
    { id: 1, golden_thread_id: 'gt-1', stage: 1, status: 'PASSED', timestamp: '2026-07-22T10:00:00Z', actor: 'jira', artifact_url: 'https://example.test/spec', parent_id: null, metadata: '{}' },
    { id: 2, golden_thread_id: 'gt-1', stage: 2, status: 'FAILED', timestamp: '2026-07-22T10:01:00Z', actor: 'runner', artifact_url: '', parent_id: '1', metadata: '{}' }
  ]
};

const analysis: RootCauseAnalysis = {
  golden_thread_id: 'gt-1',
  prod_error: { message: 'Database timeout', level: 'ERROR', first_occurrence: '2026-07-22T10:00:00Z', last_occurrence: '2026-07-22T10:01:00Z', occurrence_count: 3, affected_service: 'api' },
  was_tested: true,
  test_evidence_link: 'https://example.test/evidence',
  ci_run_link: 'https://example.test/ci',
  code_change_link: 'https://example.test/commit',
  issue_history: [{ golden_thread_id: 'old', first_seen: '2026-07-01T00:00:00Z', last_seen: '2026-07-02T00:00:00Z', occurrence_count: 2 }],
  classification: 'CodeBug',
  diagnostic_summary: 'A regression was introduced.',
  confidence: 90
};

function linkerReturning(value: GoldenThreadChain | null): GoldenThreadLinker {
  return { getChain: jest.fn().mockResolvedValue(value) } as unknown as GoldenThreadLinker;
}

describe('Golden Thread JIRA escalation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  it('creates a linked JIRA bug and normalizes the base URL', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { key: 'BUG-7' } });
    const result = await escalateToBugTicket(analysis, {
      baseUrl: 'https://jira.example.test/', ticketKey: 'BUG-1', apiToken: 'token', project_key: 'BUG', golden_thread_linker: linkerReturning(chain)
    });
    expect(result).toEqual({ ok: true, issue_key: 'BUG-7', issue_url: 'https://jira.example.test/browse/BUG-7' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://jira.example.test/rest/api/3/issue',
      expect.objectContaining({ fields: expect.objectContaining({ labels: ['golden-thread', 'CodeBug', 'confidence-90'] }) }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }), timeout: 30000 })
    );
    const payload = JSON.stringify(mockedAxios.post.mock.calls[0][1]);
    expect(payload).toContain('Golden Thread Root Cause Analysis');
    expect(payload).toContain('Commit Diff');
    expect(payload).toContain('Recurring');
  });

  it('rejects a missing chain, invalid URL, and missing authentication', async () => {
    await expect(escalateToBugTicket(analysis, { baseUrl: 'https://jira.test', ticketKey: 'P-1', apiToken: 'x', project_key: 'P', golden_thread_linker: linkerReturning(null) }))
      .resolves.toEqual({ ok: false, error: 'Golden Thread gt-1 not found' });
    await expect(escalateToBugTicket(analysis, { baseUrl: 'bad-url', ticketKey: 'P-1', apiToken: 'x', project_key: 'P', golden_thread_linker: linkerReturning(chain) }))
      .resolves.toEqual({ ok: false, error: 'Invalid JIRA base URL "bad-url"' });
    await expect(escalateToBugTicket(analysis, { baseUrl: 'https://jira.test', ticketKey: 'P-1', project_key: 'P', golden_thread_linker: linkerReturning(chain) }))
      .resolves.toEqual({ ok: false, error: 'JIRA authentication required (accessToken or apiToken)' });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('handles missing issue keys and generic request failures', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} });
    await expect(escalateToBugTicket(analysis, { baseUrl: 'https://jira.test', ticketKey: 'P-1', accessToken: 'oauth', project_key: 'P', golden_thread_linker: linkerReturning(chain) }))
      .resolves.toEqual({ ok: false, error: 'JIRA did not return an issue key' });
    mockedAxios.post.mockRejectedValueOnce(new Error('network down'));
    await expect(escalateToBugTicket(analysis, { baseUrl: 'https://jira.test', ticketKey: 'P-1', apiToken: 'x', project_key: 'P', golden_thread_linker: linkerReturning(chain) }))
      .resolves.toEqual({ ok: false, error: 'Failed to create JIRA issue: network down' });
  });

  it.each([
    [401, 'JIRA authentication failed (401)'],
    [403, 'JIRA authentication failed (403)'],
    [400, 'JIRA validation error: invalid project']
  ])('maps JIRA HTTP %i errors', async (status, expected) => {
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockedAxios.post.mockRejectedValueOnce({ response: { status, data: { errorMessages: ['invalid project'] } } });
    const result = await escalateToBugTicket(analysis, { baseUrl: 'https://jira.test', ticketKey: 'P-1', apiToken: 'x', project_key: 'P', golden_thread_linker: linkerReturning(chain) });
    expect(result).toEqual({ ok: false, error: expected });
  });

  it.each(['TestGap', 'SpecGap', 'DeploymentIssue'] as const)('renders the %s recommendation', async classification => {
    mockedAxios.post.mockResolvedValueOnce({ data: { key: 'P-1' } });
    const sparse = { ...analysis, classification, was_tested: false, test_evidence_link: null, ci_run_link: null, code_change_link: null, issue_history: [] };
    await escalateToBugTicket(sparse, { baseUrl: 'https://jira.test', ticketKey: 'P-1', apiToken: 'x', project_key: 'P', golden_thread_linker: linkerReturning(chain) });
    expect(JSON.stringify(mockedAxios.post.mock.calls[0][1])).toContain(classification);
  });
});
