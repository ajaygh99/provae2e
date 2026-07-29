import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { StudioApi } from '../api/studio-api';
import type { StudioRunApi, StudioRunEvent } from '../api/studio-run-api';
import { WorkspaceProvider } from '../workspace/WorkspaceContext';
import { StudioRunConsole } from './StudioRunConsole';
import { TestFileExplorer } from './TestFileExplorer';
import { WorkspaceSelector } from './WorkspaceSelector';

it('renders ordered stdout and stderr events until completion', async () => {
  const user = userEvent.setup();
  const file = { id: 'file_12345678', workspaceId: 'ws_12345678', name: 'x.prova.yaml', relativePath: 'x.prova.yaml', format: 'yaml' as const, updatedAt: '' };
  const workspaceApi: StudioApi = {
    selectWorkspace: vi.fn().mockResolvedValue({ id: file.workspaceId, name: 'x', testFileCount: 1 }),
    listFiles: vi.fn().mockResolvedValue([file]),
    readDocument: vi.fn().mockResolvedValue({ ...file, content: 'name: x\nurl: https://example.com\nsteps:\n - action: navigate\n', revision: 'x', diagnostics: [] }),
    saveDocument: vi.fn()
  };
  const runApi: StudioRunApi = {
    startRun: vi.fn().mockResolvedValue({ id: 'run_1234567890abcdef', workspaceId: file.workspaceId, fileId: file.id, status: 'running' }),
    streamEvents: vi.fn((_id: string, onEvent: (event: StudioRunEvent) => void) => {
      onEvent({ type: 'stdout', sequence: 1, text: 'starting\n' });
      onEvent({ type: 'stderr', sequence: 2, text: 'warning\n' });
      onEvent({ type: 'complete', sequence: 3, summary: { id: 'run_1234567890abcdef', workspaceId: file.workspaceId, fileId: file.id, status: 'passed' } });
      return vi.fn();
    }),
    cancelRun: vi.fn(),
    listRuns: vi.fn().mockResolvedValue([]),
    listEvidence: vi.fn().mockResolvedValue([]),
    evidenceUrl: vi.fn()
  };
  render(<WorkspaceProvider api={workspaceApi}><WorkspaceSelector /><TestFileExplorer /><StudioRunConsole api={runApi} /></WorkspaceProvider>);
  await user.type(screen.getByLabelText('Project directory'), 'C:\\x');
  await user.click(screen.getByRole('button', { name: 'Select workspace' }));
  await user.click(await screen.findByRole('button', { name: /x\.prova/ }));
  await user.click(screen.getByRole('button', { name: 'Run test' }));
  expect(await screen.findByText(/Run status:/)).toHaveTextContent('passed');
  expect(screen.getByLabelText('Live command output')).toHaveTextContent('starting');
  expect(screen.getByLabelText('Live command output')).toHaveTextContent('warning');
});
