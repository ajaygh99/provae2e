import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { StudioRunApi } from '../api/studio-run-api';
import { StudioResultsViewer } from './StudioResultsViewer';

it('shows recent statuses, durations, and actionable failure summaries', async () => {
  const user = userEvent.setup();
  const listRuns = vi.fn().mockResolvedValue([
    { id: 'run_failed12345678', workspaceId: 'ws_12345678', fileId: 'file_checkout', status: 'failed', durationMs: 4321, failureSummary: 'Expected 200, received 500.' },
    { id: 'run_passed12345678', workspaceId: 'ws_12345678', fileId: 'file_login', status: 'passed', durationMs: 1234 }
  ]);
  const api = {
    listRuns,
    listEvidence: vi.fn().mockImplementation((runId: string) => Promise.resolve(
      runId === 'run_failed12345678'
        ? [{ id: 'evidence_1234567890abcdef', runId, kind: 'screenshot', name: 'failure.png', mediaType: 'image/png', size: 2048 }]
        : []
    )),
    evidenceUrl: vi.fn().mockReturnValue('/evidence/failure.png')
  } as unknown as StudioRunApi;
  render(<StudioResultsViewer api={api} />);
  expect(await screen.findByText('Expected 200, received 500.', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('4321 ms')).toBeInTheDocument();
  expect(screen.getAllByText('passed').length).toBeGreaterThan(0);
  expect(await screen.findByRole('link', { name: /screenshot: failure\.png/ })).toHaveAttribute('href', '/evidence/failure.png');
  await user.click(screen.getByRole('button', { name: 'Refresh results' }));
  expect(listRuns).toHaveBeenCalledTimes(2);
});
