import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { StudioApi } from '../api/studio-api';
import { WorkspaceProvider } from '../workspace/WorkspaceContext';
import { TestFileExplorer } from './TestFileExplorer';
import { VisualStepBuilder } from './VisualStepBuilder';
import { WorkspaceSelector } from './WorkspaceSelector';

it('adds, changes, reorders, and removes steps in the shared draft', async () => {
  const user = userEvent.setup();
  const file = { id: 'file_12345678', workspaceId: 'ws_12345678', name: 'x.prova.yaml', relativePath: 'x.prova.yaml', format: 'yaml' as const, updatedAt: new Date().toISOString() };
  const api: StudioApi = {
    selectWorkspace: vi.fn().mockResolvedValue({ id: file.workspaceId, name: 'x', testFileCount: 1 }),
    listFiles: vi.fn().mockResolvedValue([file]),
    readDocument: vi.fn().mockResolvedValue({ ...file, content: 'name: x\nurl: https://example.com\nsteps:\n  - action: navigate\n', revision: 'one', diagnostics: [] }),
    saveDocument: vi.fn()
  };
  render(<WorkspaceProvider api={api}><WorkspaceSelector /><TestFileExplorer /><VisualStepBuilder /></WorkspaceProvider>);
  await user.type(screen.getByLabelText('Project directory'), 'C:\\x');
  await user.click(screen.getByRole('button', { name: 'Select workspace' }));
  await user.click(await screen.findByRole('button', { name: /x\.prova\.yaml/ }));
  await user.click(await screen.findByRole('button', { name: 'Add step' }));
  expect(screen.getAllByLabelText(/Action/)).toHaveLength(2);
  await user.selectOptions(screen.getByLabelText('Action 2'), 'click');
  expect(screen.getByLabelText('Selector')).toBeInTheDocument();
  const moveButtons = screen.getAllByRole('button', { name: 'Move up' });
  const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
  expect(moveButtons[1]).toBeDefined();
  expect(removeButtons[0]).toBeDefined();
  if (moveButtons[1] && removeButtons[0]) {
    await user.click(moveButtons[1]);
    await user.click(removeButtons[0]);
  }
  expect(screen.getAllByLabelText(/Action/)).toHaveLength(1);
});
