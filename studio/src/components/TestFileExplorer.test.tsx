import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StudioApi } from '../api/studio-api';
import { WorkspaceProvider } from '../workspace/WorkspaceContext';
import { TestFileExplorer } from './TestFileExplorer';
import { WorkspaceSelector } from './WorkspaceSelector';

const files = [
  {
    id: 'file_checkout123',
    workspaceId: 'ws_checkout123',
    name: 'checkout.prova.yaml',
    relativePath: 'tests/checkout.prova.yaml',
    format: 'yaml' as const,
    updatedAt: '2026-07-28T00:00:00.000Z'
  },
  {
    id: 'file_api12345678',
    workspaceId: 'ws_checkout123',
    name: 'api.spec.json',
    relativePath: 'tests/api.spec.json',
    format: 'json' as const,
    updatedAt: '2026-07-28T00:00:00.000Z'
  }
];

function renderExplorer(api: StudioApi): void {
  render(
    <WorkspaceProvider api={api}>
      <WorkspaceSelector />
      <TestFileExplorer />
    </WorkspaceProvider>
  );
}

describe('TestFileExplorer', () => {
  it('explains how to start before a workspace is selected', () => {
    renderExplorer({
      selectWorkspace: vi.fn(),
      listFiles: vi.fn(),
      readDocument: vi.fn(),
      saveDocument: vi.fn()
    });
    expect(screen.getByText('Select a workspace in Settings to browse test definitions.')).toBeInTheDocument();
  });

  it('lists discovered files and supports selection and refresh', async () => {
    const user = userEvent.setup();
    const listFiles = vi.fn().mockResolvedValue(files);
    renderExplorer({
      selectWorkspace: vi.fn().mockResolvedValue({
        id: 'ws_checkout123',
        name: 'checkout',
        testFileCount: 2
      }),
      listFiles,
      readDocument: vi.fn().mockResolvedValue({
        ...files[0],
        content: 'name: checkout\n',
        revision: 'revision',
        diagnostics: []
      }),
      saveDocument: vi.fn()
    });

    await user.type(screen.getByLabelText('Project directory'), 'C:\\checkout');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    expect(await screen.findByRole('button', { name: /checkout\.prova\.yaml/ })).toBeInTheDocument();
    expect(screen.getByText('tests/api.spec.json')).toBeInTheDocument();

    const checkout = screen.getByRole('button', { name: /checkout\.prova\.yaml/ });
    await user.click(checkout);
    expect(checkout).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it('renders a safe discovery error', async () => {
    const user = userEvent.setup();
    renderExplorer({
      selectWorkspace: vi.fn().mockResolvedValue({
        id: 'ws_checkout123',
        name: 'checkout',
        testFileCount: 0
      }),
      listFiles: vi.fn().mockRejectedValue(new Error('Test-file discovery failed.')),
      readDocument: vi.fn(),
      saveDocument: vi.fn()
    });

    await user.type(screen.getByLabelText('Project directory'), 'C:\\checkout');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Test-file discovery failed.');
  });
});
