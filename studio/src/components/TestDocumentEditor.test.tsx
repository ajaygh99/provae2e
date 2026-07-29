import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StudioApi, StudioTestDocument } from '../api/studio-api';
import { WorkspaceProvider } from '../workspace/WorkspaceContext';
import { TestDocumentEditor } from './TestDocumentEditor';
import { TestFileExplorer } from './TestFileExplorer';
import { WorkspaceSelector } from './WorkspaceSelector';

const file = {
  id: 'file_checkout123',
  workspaceId: 'ws_checkout123',
  name: 'checkout.prova.yaml',
  relativePath: 'tests/checkout.prova.yaml',
  format: 'yaml' as const,
  updatedAt: '2026-07-28T00:00:00.000Z'
};
const document: StudioTestDocument = {
  ...file,
  content: 'name: checkout\nurl: https://example.com\nsteps:\n  - action: navigate\n',
  revision: 'revision-one',
  diagnostics: []
};

function renderWorkflow(api: StudioApi): void {
  render(
    <WorkspaceProvider api={api}>
      <WorkspaceSelector />
      <TestFileExplorer />
      <TestDocumentEditor />
    </WorkspaceProvider>
  );
}

describe('TestDocumentEditor', () => {
  it('loads, edits, and saves using the current revision', async () => {
    const user = userEvent.setup();
    const saveDocument = vi.fn().mockImplementation(
      (_workspaceId: string, _fileId: string, content: string): Promise<StudioTestDocument> => Promise.resolve({
        ...document,
        content,
        revision: 'revision-two'
      })
    );
    renderWorkflow({
      selectWorkspace: vi.fn().mockResolvedValue({
        id: 'ws_checkout123',
        name: 'checkout',
        testFileCount: 1
      }),
      listFiles: vi.fn().mockResolvedValue([file]),
      readDocument: vi.fn().mockResolvedValue(document),
      saveDocument
    });

    await user.type(screen.getByLabelText('Project directory'), 'C:\\checkout');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    await user.click(await screen.findByRole('button', { name: /checkout\.prova\.yaml/ }));
    const editor = await screen.findByLabelText('Test definition');
    expect(editor).toHaveValue(document.content);

    await user.clear(editor);
    await user.type(editor, 'name: updated\nurl: https://example.com\nsteps:\n  - action: wait');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(saveDocument).toHaveBeenCalledWith(
      'ws_checkout123',
      'file_checkout123',
      'name: updated\nurl: https://example.com\nsteps:\n  - action: wait',
      'revision-one'
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('shows revision conflicts without discarding edits', async () => {
    const user = userEvent.setup();
    renderWorkflow({
      selectWorkspace: vi.fn().mockResolvedValue({
        id: 'ws_checkout123',
        name: 'checkout',
        testFileCount: 1
      }),
      listFiles: vi.fn().mockResolvedValue([file]),
      readDocument: vi.fn().mockResolvedValue(document),
      saveDocument: vi.fn().mockRejectedValue(new Error('The test file changed on disk. Reload it before saving.'))
    });

    await user.type(screen.getByLabelText('Project directory'), 'C:\\checkout');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    await user.click(await screen.findByRole('button', { name: /checkout\.prova\.yaml/ }));
    const editor = await screen.findByLabelText('Test definition');
    await user.type(editor, '# changed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('changed on disk');
    expect(editor).toHaveValue(`${document.content}# changed`);
  });

  it('shows actionable validation errors and blocks invalid saves', async () => {
    const user = userEvent.setup();
    const saveDocument = vi.fn();
    renderWorkflow({
      selectWorkspace: vi.fn().mockResolvedValue({
        id: 'ws_checkout123',
        name: 'checkout',
        testFileCount: 1
      }),
      listFiles: vi.fn().mockResolvedValue([file]),
      readDocument: vi.fn().mockResolvedValue(document),
      saveDocument
    });

    await user.type(screen.getByLabelText('Project directory'), 'C:\\checkout');
    await user.click(screen.getByRole('button', { name: 'Select workspace' }));
    await user.click(await screen.findByRole('button', { name: /checkout\.prova\.yaml/ }));
    const editor = await screen.findByLabelText('Test definition');
    await user.clear(editor);
    await user.type(editor, 'name: broken\nsteps:\n  - action: click');

    expect(screen.getByRole('alert')).toHaveTextContent('$.url');
    expect(screen.getByRole('alert')).toHaveTextContent('$.steps[0].selector');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(saveDocument).not.toHaveBeenCalled();
  });
});
