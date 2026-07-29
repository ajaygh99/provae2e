import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StudioApi } from '../api/studio-api';
import { WorkspaceProvider } from '../workspace/WorkspaceContext';
import { WorkspaceSelector } from './WorkspaceSelector';

function renderSelector(api: StudioApi): void {
  render(
    <WorkspaceProvider api={api}>
      <WorkspaceSelector />
    </WorkspaceProvider>
  );
}

describe('WorkspaceSelector', () => {
  it('selects a workspace and shows only safe summary metadata', async () => {
    const user = userEvent.setup();
    const selectWorkspace = vi.fn().mockResolvedValue({
      id: 'ws_12345678',
      name: 'checkout-tests',
      testFileCount: 4
    });
    renderSelector({
      selectWorkspace,
      listFiles: vi.fn().mockResolvedValue([]),
      readDocument: vi.fn(),
      saveDocument: vi.fn()
    });

    await user.type(screen.getByLabelText('Project directory'), 'C:\\projects\\checkout-tests');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));

    expect(selectWorkspace).toHaveBeenCalledWith('C:\\projects\\checkout-tests');
    expect(await screen.findByText(/Selected/)).toHaveTextContent('checkout-tests · 4 test files');
    expect(screen.queryByText(/C:\\projects/)).not.toBeInTheDocument();
  });

  it('validates blank input without calling the service', async () => {
    const user = userEvent.setup();
    const selectWorkspace = vi.fn();
    renderSelector({
      selectWorkspace,
      listFiles: vi.fn().mockResolvedValue([]),
      readDocument: vi.fn(),
      saveDocument: vi.fn()
    });

    await user.click(screen.getByRole('button', { name: 'Select workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a workspace directory');
    expect(selectWorkspace).not.toHaveBeenCalled();
  });

  it('shows a safe service error and allows retry', async () => {
    const user = userEvent.setup();
    const selectWorkspace = vi.fn()
      .mockRejectedValueOnce(new Error('Workspace directory does not exist.'))
      .mockResolvedValueOnce({ id: 'ws_12345678', name: 'tests', testFileCount: 0 });
    renderSelector({
      selectWorkspace,
      listFiles: vi.fn().mockResolvedValue([]),
      readDocument: vi.fn(),
      saveDocument: vi.fn()
    });

    const input = screen.getByLabelText('Project directory');
    await user.type(input, 'C:\\missing');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not exist');

    await user.clear(input);
    await user.type(input, 'C:\\tests');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    expect(await screen.findByText(/Selected/)).toHaveTextContent('tests');
  });
});
